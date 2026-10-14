/**
 * Characterization of bridge/shell.mjs, the L panel's `!` commands: who may
 * run one, and what comes back. Runs a real bash, so it only checks what is
 * the same on every Unix; the Windows paths (Git Bash, taskkill) are not
 * covered here.
 */
import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { handleShell, shellInfo } from '../shell.mjs'
import { FakeRequest, FakeResponse, type FakeRequestInit } from './support/fake-http.ts'

const SETTINGS = ['ULTRON_ALLOW_SHELL', 'ULTRON_SHELL', 'ULTRON_SHELL_TIMEOUT_MS'] as const

/**
 * The tests that run a command expect Unix paths and signals. On Windows the
 * shell is Git Bash (paths come back as C:/...) and a kill is taskkill, which
 * reports no signal, so what they would pin there is still unknown.
 */
const unixOnly = { skip: process.platform === 'win32' ? 'runs bash with Unix paths and signals' : false }
const PAGE = { origin: 'http://localhost:5173' }

beforeEach(() => {
  for (const name of SETTINGS) delete process.env[name]
  process.env.ULTRON_ALLOW_SHELL = '1'
})
afterEach(() => {
  for (const name of SETTINGS) delete process.env[name]
})

async function run(command: unknown, init: FakeRequestInit = {}): Promise<FakeResponse> {
  const body = typeof command === 'string' ? JSON.stringify({ command }) : JSON.stringify(command)
  const res = new FakeResponse()
  await handleShell(new FakeRequest({ method: 'POST', url: '/shell', headers: PAGE, body, ...init }), res, {})
  await res.ended
  return res
}

test('the shell is off unless ULTRON_ALLOW_SHELL=1', async () => {
  delete process.env.ULTRON_ALLOW_SHELL
  const res = await run('echo hi')
  assert.deepEqual([res.status, res.json()], [403, { error: 'shell is off: set ULTRON_ALLOW_SHELL=1 in .env.local' }])
  assert.equal(shellInfo().enabled, false)
})

test('only a page on this machine may run a command', async () => {
  const refused = { error: 'shell only answers this machine' }
  const another = await run('echo hi', { remoteAddress: '192.168.0.20' })
  const proxied = await run('echo hi', { headers: { ...PAGE, 'x-ultron-via': 'vite' } })
  const script = await run('echo hi', { headers: {} })
  for (const res of [another, proxied, script]) assert.deepEqual([res.status, res.json()], [403, refused])
})

test('a request that is not one command is refused', async () => {
  const long = await run('x'.repeat(17 * 1024))
  assert.deepEqual([long.status, long.json()], [400, { error: 'command too long' }])
  const garbled = new FakeResponse()
  await handleShell(new FakeRequest({ method: 'POST', headers: PAGE, body: '{nope' }), garbled, {})
  assert.deepEqual([garbled.status, garbled.json()], [400, { error: 'bad json' }])
  for (const command of ['   ', { command: 7 }, {}]) {
    const res = await run(command)
    assert.deepEqual([res.status, res.json()], [400, { error: 'no command' }])
  }
})

test('output streams back as NDJSON, then the exit code and where it left off', unixOnly, async () => {
  const dir = realpathSync(mkdtempSync(`${tmpdir()}/ultron-shell-`))
  const res = await run(`cd ${dir} && echo hi && echo oops >&2 && false`)
  assert.equal(res.status, 200)
  assert.equal(res.headers['content-type'], 'application/x-ndjson')
  // stdout and stderr are separate pipes, so only the trailer's place is fixed.
  const lines = res.lines()
  assert.deepEqual(lines.slice(0, 2).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), [{ e: 'oops\n' }, { o: 'hi\n' }])
  assert.deepEqual(lines[2], { done: { code: 1, signal: null, cwd: dir } })
  assert.equal(lines.length, 3)
  // The next command starts where the last one left off, as in a terminal.
  const next = await run('pwd')
  assert.deepEqual(next.lines(), [{ o: `${dir}\n` }, { done: { code: 0, signal: null, cwd: dir } }])
  assert.equal(shellInfo().cwd, dir)
})

test('a command that exits the shell reports its own exit code', unixOnly, async () => {
  const res = await run('exit 3')
  assert.deepEqual(res.lines().at(-1), { done: { code: 3, signal: null, cwd: shellInfo().cwd } })
})

test('the page going away kills the command', unixOnly, async () => {
  const res = new FakeResponse()
  const body = JSON.stringify({ command: 'sleep 30' })
  await handleShell(new FakeRequest({ method: 'POST', headers: PAGE, body }), res, {})
  setTimeout(() => res.close(), 200)
  await res.ended
  assert.deepEqual(res.lines(), [{ done: { code: -1, signal: 'SIGTERM', cwd: shellInfo().cwd } }])
})

test('a command that runs past ULTRON_SHELL_TIMEOUT_MS is cut off', unixOnly, async () => {
  process.env.ULTRON_SHELL_TIMEOUT_MS = '200'
  const res = await run('sleep 30')
  assert.deepEqual(res.lines(), [{ done: { code: -1, signal: 'SIGTERM', cwd: shellInfo().cwd } }])
})

test('a shell that cannot start says so', unixOnly, async () => {
  process.env.ULTRON_SHELL = '/nonexistent/bash'
  const res = await run('echo hi')
  const [error, done] = res.lines() as Array<{ e?: string; done?: { code: number } }>
  assert.match(String(error?.e), /^could not start \/nonexistent\/bash: /)
  assert.equal(done?.done?.code, -1)
  assert.equal(shellInfo().shell, '/nonexistent/bash')
})
