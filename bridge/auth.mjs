import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Who may talk to the bridge from outside this machine.
 *
 * On its own the bridge only listens on loopback, and the browser on this PC
 * talks to it directly, exactly as before. Reaching it from a phone or another
 * computer goes through the Vite dev server's `/bridge` proxy, normally behind
 * `tailscale serve` (docs/remote.md). Every proxied request is "remote": it
 * needs ULTRON_PASSWORD set, and a login cookie that proves the password.
 *
 * Telling the two apart cannot rely on the source address, because a proxy on
 * this machine connects from 127.0.0.1 too. It relies on the proxy saying so:
 * the Vite proxy stamps `x-ultron-via`, and tailscale serve and any ordinary
 * reverse proxy add forwarding headers. A request with none of them, from
 * loopback, came straight from a process on this PC.
 */

const COOKIE = 'ultron_auth'
const YEAR_S = 365 * 24 * 60 * 60

const password = () => process.env.ULTRON_PASSWORD ?? ''

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/** Came through a proxy (or from another machine), so it is not this PC. */
export function isRemote(req) {
  if (!LOOPBACK.has(req.socket.remoteAddress)) return true
  const h = req.headers
  if (h['x-ultron-via'] || h['x-forwarded-for'] || h['x-forwarded-host'] || h.forwarded) {
    return true
  }
  return Object.keys(h).some((k) => k.startsWith('tailscale-'))
}

/** Remote access is on only with a password to guard it. */
export const remoteEnabled = () => password().length > 0

/**
 * The cookie's value: derived from the password, so changing the password
 * logs every device out, and nothing has to be stored on this side.
 */
function token() {
  return createHmac('sha256', password()).update('ultron-session-v1').digest('hex')
}

function same(a, b) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function cookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return ''
}

export function loggedIn(req) {
  return remoteEnabled() && same(cookie(req, COOKIE), token())
}

/** The host the remote page was loaded from, as the proxy reports it. */
function publicHost(req) {
  return String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
    .split(',')[0]
    .trim()
}

/**
 * The page asking is the one the proxy served. Through the proxy the page and
 * the bridge share an origin, so a remote request whose Origin names any other
 * host is a different site trying its luck.
 */
export function sameOrigin(req, origin) {
  if (!origin) return false
  try {
    return new URL(origin).host === publicHost(req)
  } catch {
    return false
  }
}

/** Where a proxied page reaches the bridge, for links the bridge writes. */
export function publicOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0].trim()
  return `${proto}://${publicHost(req)}/bridge`
}

/**
 * Whether a request may go on, and why not. Local requests are left to the
 * existing origin check; remote ones need the password switched on, the page's
 * own origin (when the browser sends one) and the login cookie.
 */
export function gate(req) {
  if (!isRemote(req)) return { ok: true, remote: false }
  if (!remoteEnabled()) return { ok: false, remote: true, why: 'remote access is off' }
  const origin = req.headers.origin
  if (origin && !sameOrigin(req, origin)) return { ok: false, remote: true, why: 'foreign origin' }
  if (!loggedIn(req)) return { ok: false, remote: true, why: 'login required' }
  return { ok: true, remote: true }
}

/** Failed logins, to slow down guessing. */
let failures = []

async function readJson(req, max = 4096) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > max) throw new Error('too long')
  }
  return JSON.parse(body || '{}')
}

/**
 * GET /auth — whether this page has to log in first.
 * POST /login {password} — sets the cookie.
 * Both answer before the gate, since a page that is not logged in has to be
 * able to find that out and fix it.
 */
export async function handleAuth(req, res, cors) {
  const json = { ...cors, 'content-type': 'application/json' }
  const path = (req.url ?? '').split('?')[0]
  const remote = isRemote(req)

  if (req.method === 'GET' && path === '/auth') {
    res.writeHead(200, json)
    return res.end(
      JSON.stringify({
        remote,
        required: remote,
        enabled: remote ? remoteEnabled() : undefined,
        ok: !remote || loggedIn(req),
      }),
    )
  }

  if (req.method === 'POST' && path === '/login') {
    if (!remote) {
      res.writeHead(200, json)
      return res.end(JSON.stringify({ ok: true }))
    }
    if (!remoteEnabled()) {
      res.writeHead(403, json)
      return res.end(JSON.stringify({ error: 'remote access is off: set ULTRON_PASSWORD' }))
    }
    if (!sameOrigin(req, req.headers.origin)) {
      res.writeHead(403, json)
      return res.end(JSON.stringify({ error: 'forbidden' }))
    }
    const now = Date.now()
    failures = failures.filter((t) => now - t < 60_000)
    if (failures.length >= 5) {
      res.writeHead(429, json)
      return res.end(JSON.stringify({ error: 'too many attempts, wait a minute' }))
    }
    let given = ''
    try {
      given = String((await readJson(req)).password ?? '')
    } catch {
      res.writeHead(400, json)
      return res.end(JSON.stringify({ error: 'bad request' }))
    }
    if (!same(given, password())) {
      failures.push(now)
      console.warn('[ultron] failed remote login')
      // A beat of delay costs a person nothing and a guesser a lot.
      await new Promise((r) => setTimeout(r, 800))
      res.writeHead(401, json)
      return res.end(JSON.stringify({ error: 'wrong password' }))
    }
    console.log('[ultron] remote device logged in')
    res.writeHead(200, {
      ...json,
      'set-cookie':
        `${COOKIE}=${token()}; Path=/; Max-Age=${YEAR_S}; HttpOnly; Secure; SameSite=Strict`,
    })
    return res.end(JSON.stringify({ ok: true }))
  }

  return false
}
