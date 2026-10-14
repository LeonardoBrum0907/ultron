/**
 * Characterization of bridge/auth.mjs: who counts as this PC, what the gate
 * lets through, and how a remote device logs in. Pins the code as it is,
 * before it moves to TypeScript.
 */
import { afterEach, test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { gate, handleAuth, isRemote, loggedIn, publicOrigin, remoteEnabled, sameOrigin } from '../auth.mjs'
import { FakeRequest, FakeResponse, type FakeRequestInit } from './support/fake-http.ts'

const PASSWORD = 'test-password'
const PHONE = 'https://pc.tailnet.ts.net'
/** A request through the Vite proxy, as the phone's page sends it. */
const proxied = (init: FakeRequestInit = {}) =>
  new FakeRequest({ ...init, headers: { 'x-ultron-via': 'vite', 'x-forwarded-host': 'pc.tailnet.ts.net', ...init.headers } })

afterEach(() => {
  delete process.env.ULTRON_PASSWORD
  mock.timers.reset()
})

async function login(password: string, init: FakeRequestInit = {}): Promise<FakeResponse> {
  const req = proxied({ method: 'POST', url: '/login', body: JSON.stringify({ password }), headers: { origin: PHONE }, ...init })
  const res = new FakeResponse()
  await handleAuth(req, res, {})
  return res
}

/** The cookie a correct login sets, as the browser would send it back. */
async function loginCookie(): Promise<string> {
  const res = await login(PASSWORD)
  return String(res.headers['set-cookie']).split(';')[0] ?? ''
}

test('this PC is a request from loopback that no proxy touched', () => {
  assert.equal(isRemote(new FakeRequest()), false)
  assert.equal(isRemote(new FakeRequest({ remoteAddress: '::1' })), false)
  assert.equal(isRemote(new FakeRequest({ remoteAddress: '::ffff:127.0.0.1' })), false)
  assert.equal(isRemote(new FakeRequest({ remoteAddress: '192.168.0.20' })), true)
  for (const header of ['x-ultron-via', 'x-forwarded-for', 'x-forwarded-host', 'forwarded', 'tailscale-user-login']) {
    assert.equal(isRemote(new FakeRequest({ headers: { [header]: 'x' } })), true, header)
  }
})

test('remote access is on only with a password', () => {
  assert.equal(remoteEnabled(), false)
  process.env.ULTRON_PASSWORD = PASSWORD
  assert.equal(remoteEnabled(), true)
})

test('the gate waves this PC through and stops remote requests in order', async () => {
  assert.deepEqual(gate(new FakeRequest()), { ok: true, remote: false })
  assert.deepEqual(gate(proxied()), { ok: false, remote: true, why: 'remote access is off' })
  process.env.ULTRON_PASSWORD = PASSWORD
  assert.deepEqual(gate(proxied({ headers: { origin: 'https://evil.example' } })), { ok: false, remote: true, why: 'foreign origin' })
  assert.deepEqual(gate(proxied({ headers: { origin: PHONE } })), { ok: false, remote: true, why: 'login required' })
  const cookie = await loginCookie()
  assert.deepEqual(gate(proxied({ headers: { origin: PHONE, cookie } })), { ok: true, remote: true })
  // No Origin at all (a WebSocket from some clients, a plain fetch) only needs the cookie.
  assert.deepEqual(gate(proxied({ headers: { cookie } })), { ok: true, remote: true })
})

test('a login sets a year-long cookie, and a new password logs every device out', async () => {
  process.env.ULTRON_PASSWORD = PASSWORD
  const res = await login(PASSWORD)
  assert.equal(res.status, 200)
  assert.deepEqual(res.json(), { ok: true })
  assert.match(
    String(res.headers['set-cookie']),
    /^ultron_auth=[0-9a-f]{64}; Path=\/; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict$/,
  )
  const cookie = String(res.headers['set-cookie']).split(';')[0] ?? ''
  assert.equal(loggedIn(proxied({ headers: { cookie: `theme=dark; ${cookie}` } })), true)
  process.env.ULTRON_PASSWORD = 'another-password'
  assert.equal(loggedIn(proxied({ headers: { cookie } })), false)
})

test('the page origin must be the host the proxy served', () => {
  const req = proxied({ headers: { 'x-forwarded-host': 'pc.tailnet.ts.net, inner:5173' } })
  assert.equal(sameOrigin(req, PHONE), true)
  assert.equal(sameOrigin(req, 'https://pc.tailnet.ts.net:8443'), false)
  assert.equal(sameOrigin(req, 'not a url'), false)
  assert.equal(sameOrigin(req, undefined), false)
  // Without forwarding headers the Host header is the host.
  assert.equal(sameOrigin(new FakeRequest({ headers: { host: 'localhost:5173' } }), 'http://localhost:5173'), true)
})

test('links the bridge writes for a remote page go through its /bridge proxy', () => {
  assert.equal(publicOrigin(proxied()), 'https://pc.tailnet.ts.net/bridge')
  assert.equal(publicOrigin(proxied({ headers: { 'x-forwarded-proto': 'http, https' } })), 'http://pc.tailnet.ts.net/bridge')
})

test('GET /auth tells a page whether it has to log in', async () => {
  const local = new FakeResponse()
  await handleAuth(new FakeRequest({ url: '/auth' }), local, { 'access-control-allow-origin': 'x' })
  assert.equal(local.headers['access-control-allow-origin'], 'x')
  assert.deepEqual(local.json(), { remote: false, required: false, ok: true })

  process.env.ULTRON_PASSWORD = PASSWORD
  const remote = new FakeResponse()
  await handleAuth(proxied({ url: '/auth' }), remote, {})
  assert.deepEqual(remote.json(), { remote: true, required: true, enabled: true, ok: false })
})

test('a login from this PC needs nothing', async () => {
  const res = new FakeResponse()
  await handleAuth(new FakeRequest({ method: 'POST', url: '/login' }), res, {})
  assert.deepEqual([res.status, res.json(), res.headers['set-cookie']], [200, { ok: true }, undefined])
})

test('a remote login is refused while remote access is off, or from another site', async () => {
  const off = await login(PASSWORD)
  assert.deepEqual([off.status, off.json()], [403, { error: 'remote access is off: set ULTRON_PASSWORD' }])
  process.env.ULTRON_PASSWORD = PASSWORD
  const foreign = await login(PASSWORD, { headers: { origin: 'https://evil.example' } })
  assert.deepEqual([foreign.status, foreign.json()], [403, { error: 'forbidden' }])
  const garbled = proxied({ method: 'POST', url: '/login', body: '{nope', headers: { origin: PHONE } })
  const bad = new FakeResponse()
  await handleAuth(garbled, bad, {})
  assert.deepEqual([bad.status, bad.json()], [400, { error: 'bad request' }])
})

test('other paths are not the login handler\'s', async () => {
  assert.equal(await handleAuth(new FakeRequest({ url: '/health' }), new FakeResponse(), {}), false)
})

/** A wrong password waits 800 ms before answering; the fake clock skips the wait. */
async function wrongLogin(): Promise<FakeResponse> {
  const pending = login('wrong')
  let res: FakeResponse | null = null
  void pending.then((r) => (res = r))
  while (!res) {
    await new Promise((r) => setImmediate(r))
    mock.timers.tick(800)
  }
  return res
}

// One test, because the failures are counted for the whole module.
test('five wrong passwords in a minute lock logins out until the minute is up', async () => {
  process.env.ULTRON_PASSWORD = PASSWORD
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  for (let i = 0; i < 5; i++) {
    const res = await wrongLogin()
    assert.deepEqual([res.status, res.json()], [401, { error: 'wrong password' }])
  }
  // Even the right password, once locked.
  const locked = await login(PASSWORD)
  assert.deepEqual([locked.status, locked.json()], [429, { error: 'too many attempts, wait a minute' }])
  mock.timers.tick(60_000)
  assert.equal((await login(PASSWORD)).status, 200)
})
