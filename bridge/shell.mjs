/**
 * The L panel's `!` commands: one line run in a shell on this machine.
 *
 * Off unless ULTRON_ALLOW_SHELL=1. Anything that can reach this endpoint can
 * run anything as you, so on top of the switch it answers only the loopback
 * address (the bridge listens on every interface for the LAN case) and only a
 * page whose Origin the bridge already trusts. A browser always sends Origin on
 * a POST, and the JSON body forces a preflight, so another site's page cannot
 * get a command in either.
 *
 * On Windows the shell is Git Bash when it is installed where the installer
 * puts it; ULTRON_SHELL names another. One command per request, no terminal:
 * git, npm and scripts work, interactive programs (vim, a password prompt) do
 * not. The working directory carries over from one command to the next, so
 * `cd` behaves as it would in a terminal. The page aborting the request (the
 * panel's `kill`) kills the command.
 *
 * Output streams back as NDJSON lines: {o: text} for stdout, {e: text} for
 * stderr, then {done: {code, cwd}}.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

export const SHELL_ENABLED = process.env.ULTRON_ALLOW_SHELL === '1'

const GIT_BASH = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']

export const SHELL_PATH =
  process.env.ULTRON_SHELL ||
  (process.platform === 'win32' ? (GIT_BASH.find((p) => existsSync(p)) ?? 'bash.exe') : 'bash')

/** Where commands run; moved by `cd`. Starts in the folder the bridge was started from. */
let cwd = process.env.ULTRON_SHELL_CWD || process.cwd()

/** Commands are cut off after this long unless the page stops them first. */
const MAX_MS = Number(process.env.ULTRON_SHELL_TIMEOUT_MS ?? 10 * 60 * 1000)

/** Marks the trailer the wrapper prints after the command: cwd and exit code. */
const SEP = '\x1e'

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/**
 * Kill the command and everything it started. Killing the shell alone leaves
 * its children running (a `! npm run dev` would keep serving after `kill`), so
 * on Windows taskkill takes the tree and elsewhere the process group goes.
 */
function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill())
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill()
    }
  }
}

export function shellInfo() {
  return { enabled: SHELL_ENABLED, shell: SHELL_PATH, cwd }
}

export async function handleShell(req, res, cors) {
  const json = { ...cors, 'content-type': 'application/json' }
  if (!SHELL_ENABLED) {
    res.writeHead(403, json)
    return res.end(JSON.stringify({ error: 'shell is off: set ULTRON_ALLOW_SHELL=1 in .env.local' }))
  }
  if (!LOOPBACK.has(req.socket.remoteAddress) || !req.headers.origin) {
    res.writeHead(403, json)
    return res.end(JSON.stringify({ error: 'shell only answers this machine' }))
  }
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 16 * 1024) {
      res.writeHead(400, json)
      return res.end(JSON.stringify({ error: 'command too long' }))
    }
  }
  let command
  try {
    ;({ command } = JSON.parse(body || '{}'))
  } catch {
    res.writeHead(400, json)
    return res.end(JSON.stringify({ error: 'bad json' }))
  }
  if (typeof command !== 'string' || !command.trim()) {
    res.writeHead(400, json)
    return res.end(JSON.stringify({ error: 'no command' }))
  }

  // Run it, then print where it left us and how it went, behind a separator
  // nothing normal prints. pwd -W is Git Bash's Windows form (C:/...), which is
  // what spawn needs as a cwd next time; elsewhere plain pwd.
  const script =
    `${command}\n` +
    `__ultron_ec=$?\n` +
    `printf '${SEP}%s${SEP}%d' "$(pwd -W 2>/dev/null || pwd)" "$__ultron_ec"\n`

  if (!existsSync(cwd)) cwd = homedir()
  const child = spawn(SHELL_PATH, ['-lc', script], {
    cwd,
    env: { ...process.env, TERM: 'dumb', NO_COLOR: '1', FORCE_COLOR: '0', GIT_PAGER: 'cat', PAGER: 'cat' },
    windowsHide: true,
    // Its own process group, so killTree can take the children with it.
    detached: process.platform !== 'win32',
  })
  console.log(`[ultron] shell: ${command.slice(0, 120)}`)

  res.writeHead(200, { ...cors, 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' })
  const send = (obj) => res.write(`${JSON.stringify(obj)}\n`)

  // stdout is held back by the trailer's length at most, so the trailer never
  // reaches the page even when it arrives split across chunks.
  let tail = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (d) => {
    tail += d
    const cut = tail.indexOf(SEP)
    const keep = cut >= 0 ? tail.length - cut : 0
    const out = tail.slice(0, tail.length - keep)
    tail = tail.slice(tail.length - keep)
    if (out) send({ o: out })
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (d) => send({ e: d }))

  const timer = setTimeout(() => killTree(child), MAX_MS)
  // The panel's `kill`, or the page going away.
  res.on('close', () => {
    killTree(child)
  })

  child.on('error', (err) => {
    clearTimeout(timer)
    send({ e: `could not start ${SHELL_PATH}: ${err.message}\n` })
    send({ done: { code: -1, cwd } })
    res.end()
  })
  child.on('close', (code, signal) => {
    clearTimeout(timer)
    const parts = tail.split(SEP)
    let ec = code ?? -1
    if (parts.length >= 3) {
      if (parts[0]) send({ o: parts[0] })
      if (parts[1] && existsSync(parts[1])) cwd = parts[1]
      ec = Number(parts[2])
    } else if (tail) send({ o: tail })
    send({ done: { code: signal ? -1 : ec, signal: signal ?? null, cwd } })
    res.end()
  })
}
