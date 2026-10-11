/**
 * A stand-in for @anthropic-ai/claude-agent-sdk, swapped in by
 * fake-sdk-hooks.mjs so the bridge can be driven end to end without a Claude
 * login and without spending anything.
 *
 * It answers a few scripted questions with the same message shapes the real
 * SDK emits (stream events, assistant and user messages, results, init), asks
 * the bridge's canUseTool the way the CLI does, and calls the bridge's own
 * in-process tools so their frames reach the sockets. Everything the bridge
 * hands it is written to ULTRON_FAKE_LOG as one JSON object per line.
 */
import { appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'

interface ToolReply {
  isError?: boolean
  content: Array<{ type: string; text?: string; mimeType?: string }>
}

interface FakeTool {
  name: string
  description: string
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<ToolReply>
}

interface FakeServer {
  type: 'sdk'
  name: string
  instructions?: string
  alwaysLoad?: boolean
  tools: FakeTool[]
}

interface Permission {
  behavior: 'allow' | 'deny'
  message?: string
}

interface QueryOptions {
  model?: string
  effort?: string
  resume?: string
  systemPrompt?: string
  cwd?: string
  settingSources?: string[]
  maxTurns?: number
  permissionMode?: string
  includePartialMessages?: boolean
  mcpServers?: Record<string, unknown>
  agents?: Record<string, { description: string; prompt: string; model: string; effort: string }>
  canUseTool?: (name: string, input: unknown, extra: unknown) => Promise<Permission>
}

interface UserMessage {
  message: { content: string }
}

type SdkMessage = Record<string, unknown>

/** Short, stable fingerprint of a long string, so the log stays readable. */
const fingerprint = (text: string | undefined) =>
  text == null ? null : createHash('sha1').update(text).digest('hex').slice(0, 12)

function record(entry: Record<string, unknown>): void {
  const file = process.env.ULTRON_FAKE_LOG
  if (file) appendFileSync(file, `${JSON.stringify(entry)}\n`)
}

export function tool(
  name: string,
  description: string,
  inputSchema: unknown,
  handler: FakeTool['handler'],
): FakeTool & { inputSchema: unknown } {
  return { name, description, inputSchema, handler }
}

export function createSdkMcpServer(options: Omit<FakeServer, 'type'>): FakeServer {
  return { type: 'sdk', ...options }
}

function isFakeServer(value: unknown): value is FakeServer {
  return typeof value === 'object' && value !== null && (value as FakeServer).type === 'sdk'
}

function describeServers(servers: Record<string, unknown>) {
  const inProcess: Record<string, string[]> = {}
  for (const [key, server] of Object.entries(servers)) {
    if (isFakeServer(server)) inProcess[key] = server.tools.map((t) => t.name)
  }
  return { servers: Object.keys(servers).sort(), inProcess }
}

function describeAgents(agents: QueryOptions['agents']) {
  if (!agents) return null
  return Object.fromEntries(
    Object.entries(agents).map(([name, a]) => [
      name,
      { model: a.model, effort: a.effort, description: a.description, prompt: fingerprint(a.prompt) },
    ]),
  )
}

function recordOptions(options: QueryOptions): void {
  record({
    event: 'query',
    model: options.model,
    effort: options.effort,
    resume: options.resume ?? null,
    systemPrompt: fingerprint(options.systemPrompt),
    cwdIsHome: options.cwd === homedir(),
    settingSources: options.settingSources,
    maxTurns: options.maxTurns,
    permissionMode: options.permissionMode,
    includePartialMessages: options.includePartialMessages,
    ...describeServers(options.mcpServers ?? {}),
    agents: describeAgents(options.agents),
  })
}

const textDelta = (text: string, parent: string | null = null): SdkMessage => ({
  type: 'stream_event',
  parent_tool_use_id: parent,
  event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
})

const toolStart = (id: string, name: string, parent: string | null = null): SdkMessage => ({
  type: 'stream_event',
  parent_tool_use_id: parent,
  event: { type: 'content_block_start', content_block: { type: 'tool_use', id, name } },
})

const toolResult = (id: string, isError: boolean): SdkMessage => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError }] },
})

const success = (sessionId: string, result: string): SdkMessage => ({
  type: 'result',
  subtype: 'success',
  session_id: sessionId,
  result,
  total_cost_usd: 0.01,
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
  duration_ms: 42,
  num_turns: 1,
})

/**
 * One fake session. Tools are "run" the way the CLI runs them: the bridge's
 * canUseTool decides, and the bridge's own in-process tools really execute.
 */
class FakeSession {
  private stopInterrupt: (() => void) | null = null
  private readonly options: QueryOptions
  private readonly sessionId: string

  constructor(options: QueryOptions) {
    this.options = options
    this.sessionId = options.resume ?? 'sess-new'
  }

  interrupted(): void {
    this.stopInterrupt?.()
  }

  private async permits(name: string): Promise<boolean> {
    const verdict = await this.options.canUseTool?.(name, {}, {})
    record({ event: 'canUseTool', tool: name, behavior: verdict?.behavior ?? null })
    return verdict?.behavior === 'allow'
  }

  private async runOwnTool(id: string, name: string, args: Record<string, unknown>) {
    const [, key, toolName] = name.split('__')
    const server = this.options.mcpServers?.[key ?? '']
    const found = isFakeServer(server) ? server.tools.find((t) => t.name === toolName) : undefined
    const reply = found ? await found.handler(args, {}) : { isError: true, content: [] }
    record({ event: 'toolReply', tool: name, isError: reply.isError === true, content: reply.content })
    return { message: toolResult(id, reply.isError === true), reply }
  }

  /** A tool the CLI would run on its own: allowed or refused, never executed here. */
  private async *external(id: string, name: string, parent: string | null = null) {
    yield toolStart(id, name, parent)
    yield toolResult(id, !(await this.permits(name)))
  }

  private async *tools(): AsyncGenerator<SdkMessage> {
    yield toolStart('tu-blade', 'mcp__ultron__blade')
    await this.permits('mcp__ultron__blade')
    yield (await this.runOwnTool('tu-blade', 'mcp__ultron__blade', {
      title: 'MARK VII', kind: 'markup', html: '<p>armour</p>',
    })).message
    // The completed assistant message repeats the block; the bridge dedupes it.
    yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu-blade', name: 'mcp__ultron__blade' }] } }
    yield toolStart('tu-theme', 'mcp__ultron_ui__ui_theme')
    yield (await this.runOwnTool('tu-theme', 'mcp__ultron_ui__ui_theme', { accent: '#ff2a2a' })).message
    yield* this.external('tu-bash', 'Bash')
    yield* this.external('tu-call', 'mcp__phone__make_outbound_call')
    // Refused by the bridge's policy, yet the CLI ran it: the late announcement.
    yield toolStart('tu-held', 'mcp__phone__ring')
    yield toolResult('tu-held', false)
    yield* this.external('tu-agent', 'Agent')
    yield textDelta('subagent report, never spoken', 'tu-agent')
    yield* this.external('tu-search', 'mcp__exa__search', 'tu-agent')
    yield textDelta('Done.')
    yield success(this.sessionId, 'Done.')
  }

  private async *look(): AsyncGenerator<SdkMessage> {
    yield toolStart('tu-look', 'mcp__ultron_eyes__look')
    const { message, reply } = await this.runOwnTool('tu-look', 'mcp__ultron_eyes__look', { reason: 'testing' })
    yield message
    const image = reply.content.find((c) => c.type === 'image')
    const said = image ? `I see ${image.mimeType}.` : 'I cannot see.'
    yield textDelta(said)
    yield success(this.sessionId, said)
  }

  private async *slow(): AsyncGenerator<SdkMessage> {
    yield textDelta('one')
    await new Promise<void>((resolve) => {
      this.stopInterrupt = resolve
      setTimeout(resolve, 3000)
    })
    this.stopInterrupt = null
    yield success(this.sessionId, 'one')
  }

  private async *answer(text: string): AsyncGenerator<SdkMessage> {
    const asked = text.split('\n').at(-1) ?? ''
    if (asked === 'tools') return yield* this.tools()
    if (asked === 'look') return yield* this.look()
    if (asked === 'slow') return yield* this.slow()
    if (asked === 'fail') {
      return yield { type: 'result', subtype: 'error_max_turns', total_cost_usd: 0.02, errors: ['too long'] }
    }
    yield textDelta('Hel')
    yield textDelta('lo.')
    yield success(this.sessionId, 'Hello.')
  }

  async *run(prompt: AsyncIterable<UserMessage>): AsyncGenerator<SdkMessage> {
    let first = true
    for await (const user of prompt) {
      const text = user.message.content
      record({ event: 'user', text })
      if (first && this.options.resume === 'broken') throw new Error('No conversation found with that id')
      if (first) {
        first = false
        yield {
          type: 'system',
          subtype: 'init',
          session_id: this.sessionId,
          mcp_servers: [
            { name: 'ultron', status: 'connected' },
            { name: 'phone', status: 'pending' },
            { name: 'locked', status: 'needs-auth' },
            { name: 'broken', status: 'failed' },
          ],
        }
      }
      yield* this.answer(text)
    }
  }
}

export function query({ prompt, options }: { prompt: AsyncIterable<UserMessage>; options: QueryOptions }) {
  recordOptions(options)
  const session = new FakeSession(options)
  const stream = session.run(prompt)
  return Object.assign(stream, {
    interrupt: async () => {
      record({ event: 'interrupt' })
      session.interrupted()
    },
    close: () => record({ event: 'close' }),
  })
}
