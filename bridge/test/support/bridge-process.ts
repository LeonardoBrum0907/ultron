/**
 * Runs the real bridge in a child process against the fake Agent SDK, with a
 * throwaway home directory, so a test sees exactly what the apps see.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const HOOKS = fileURLToPath(new URL('./fake-sdk-hooks.mjs', import.meta.url))

/** The bridge entry point every test starts. */
export const BRIDGE_ENTRY = 'bridge/server.mjs'

/** Every setting the bridge reads, pinned so a developer's .env.local cannot leak in. */
function pinnedEnv(home: string, port: number, extra: Record<string, string>) {
  return {
    PATH: process.env.PATH ?? '',
    SYSTEMROOT: process.env.SYSTEMROOT ?? '',
    HOME: home,
    USERPROFILE: home,
    ULTRON_HOME: join(home, '.ultron'),
    ULTRON_FAKE_LOG: join(home, 'fake-sdk.log'),
    ULTRON_BRIDGE_PORT: String(port),
    ULTRON_LANG: 'pt-BR',
    ULTRON_STT: 'browser',
    ULTRON_MODEL: 'claude-sonnet-5-5',
    ULTRON_EFFORT: 'low',
    ULTRON_HEAVY_MODEL: 'claude-opus-5-5',
    ULTRON_HEAVY_EFFORT: 'high',
    ULTRON_VOICE_ID: 'JBFqnCBsd6RMkjVDRZzb',
    ULTRON_ALLOW_WRITES: '',
    ULTRON_ALLOW_SHELL: '',
    ULTRON_ALLOWED_ORIGINS: '',
    ULTRON_ALLOW_NO_ORIGIN: '',
    ULTRON_PASSWORD: '',
    ULTRON_DEBUG: '',
    ULTRON_FILE_ROOTS: '',
    ELEVENLABS_API_KEY: '',
    ...extra,
  }
}

/** A Claude Code config with two external MCP servers, as ~/.claude.json. */
function writeClaudeConfig(home: string): void {
  const config = { mcpServers: { phone: { command: 'phone-mcp' }, exa: { command: 'exa-mcp' } } }
  writeFileSync(join(home, '.claude.json'), JSON.stringify(config))
}

let nextPort = 18700 + (process.pid % 500) * 2

export class BridgeProcess {
  readonly home: string
  readonly port: number
  private child: ChildProcess | null = null

  constructor() {
    this.home = mkdtempSync(join(tmpdir(), 'ultron-bridge-'))
    this.port = nextPort++
    writeClaudeConfig(this.home)
  }

  /** Leaves a conversation on disk for the bridge to resume. */
  saveConversation(id: string, turns: number): void {
    mkdirSync(join(this.home, '.ultron'), { recursive: true })
    const saved = { id, since: '2026-10-01T00:00:00.000Z', turns }
    writeFileSync(join(this.home, '.ultron', 'conversa.json'), JSON.stringify(saved))
  }

  async start(extraEnv: Record<string, string> = {}): Promise<void> {
    const args = ['--import', 'tsx', '--import', HOOKS, BRIDGE_ENTRY]
    this.child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: pinnedEnv(this.home, this.port, extraEnv),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    await this.waitForBanner()
  }

  private waitForBanner(): Promise<void> {
    return new Promise((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => reject(new Error(`bridge did not start: ${output}`)), 15_000)
      const onData = (chunk: Buffer) => {
        output += chunk.toString()
        if (!output.includes('bridge listening')) return
        clearTimeout(timer)
        resolve()
      }
      this.child?.stdout?.on('data', onData)
      this.child?.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()))
      this.child?.on('exit', (code) => reject(new Error(`bridge exited (${code}): ${output}`)))
    })
  }

  /** What the fake SDK was handed and asked, in order. */
  fakeLog(): Array<Record<string, unknown>> {
    const file = join(this.home, 'fake-sdk.log')
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  }

  savedConversation(): unknown {
    const file = join(this.home, '.ultron', 'conversa.json')
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
  }

  async http(method: string, path: string): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`http://127.0.0.1:${this.port}${path}`, { method })
    const text = await res.text()
    const isJson = (res.headers.get('content-type') ?? '').includes('json')
    return { status: res.status, body: isJson ? JSON.parse(text) : text }
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child || child.exitCode !== null) return
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
      child.kill()
    })
  }
}

type Frame = Record<string, unknown>

/** One app connected to the bridge: every frame it receives, in order. */
export class FakeFace {
  readonly frames: Frame[] = []
  private readonly socket: WebSocket
  private waiters: Array<{ match: (f: Frame) => boolean; resolve: (f: Frame) => void }> = []
  private onFrame: ((f: Frame) => void) | null = null

  constructor(port: number) {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'http://localhost:5173' })
    this.socket.on('message', (raw) => this.receive(JSON.parse(raw.toString()) as Frame))
  }

  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once('open', () => resolve())
      this.socket.once('error', reject)
    })
  }

  /** Called for every frame, before waiters see it: how a test reacts mid-turn. */
  react(onFrame: ((f: Frame) => void) | null): void {
    this.onFrame = onFrame
  }

  private receive(frame: Frame): void {
    this.frames.push(frame)
    this.onFrame?.(frame)
    const ready = this.waiters.filter((w) => w.match(frame))
    this.waiters = this.waiters.filter((w) => !w.match(frame))
    for (const w of ready) w.resolve(frame)
  }

  send(message: Frame): void {
    this.socket.send(JSON.stringify(message))
  }

  waitFor(match: (f: Frame) => boolean, what: string): Promise<Frame> {
    const seen = this.frames.find(match)
    if (seen) return Promise.resolve(seen)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no frame: ${what}`)), 8000)
      this.waiters.push({ match, resolve: (f) => { clearTimeout(timer); resolve(f) } })
    })
  }

  /** Waits for the turn with this ask id to end, well or badly. */
  turnEnded(ask: string): Promise<Frame> {
    return this.waitFor((f) => f.ask === ask && (f.type === 'done' || f.type === 'error'), `end of ${ask}`)
  }

  close(): void {
    this.socket.close()
  }
}
