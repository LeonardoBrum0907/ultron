/**
 * ULTRON local bridge.
 *
 * Holds the one conversation every app shares and exposes it over a
 * WebSocket. The browser stays the face and the voice; this process is the
 * brain and the hands. Which model thinks is behind a port
 * (bridge/brain/brain.ts); today it is Claude, through the Claude Agent SDK
 * (bridge/brain/claude.ts), which needs no API key and reaches every MCP
 * server in your Claude Code config.
 *
 *   npm run bridge
 */

import { WebSocketServer } from 'ws'
import { chromeAvailable } from './chrome.mjs'
import { homedir, tmpdir } from 'node:os'
import { readFileSync, realpathSync } from 'node:fs'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import { openRemote, proxyError, vetTarget, PROXY_UA } from './net.mjs'
import { probeUrl, renderPage } from './page.mjs'
import { handleShell, shellInfo } from './shell.mjs'
import { gate, handleAuth, isRemote, publicOrigin, remoteEnabled, sameOrigin } from './auth.mjs'
import { forgetConversation, rememberConversation, savedConversation, ULTRON_DIR } from './memory.ts'
import { toolPolicy } from './policy.ts'
import { readBridgeConfig } from './config.ts'
import { personaPrompts } from './persona.ts'
import { claudeAgentBrain } from './brain/claude.ts'
import { brainChoiceFile } from './brain-choice-file.ts'
import { brainRoute } from './brain-route.ts'
import { ConversationSlot } from './conversation.ts'
import { Devices } from './devices.ts'
import { ownTools } from './tools/own.ts'
import { aiMemory, memoryBanner } from './long-memory/ai-memory.ts'

// The same .env.local the Vite app reads, so the ElevenLabs key and the
// ULTRON_* settings can live in one file instead of the shell. Variables
// already set in the shell win: loadEnvFile never overwrites them.
for (const name of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(new URL(`../${name}`, import.meta.url))
  } catch {
    // Missing file, or a Node without loadEnvFile: the shell env still works.
  }
}

const config = readBridgeConfig(process.env)

const PORT = config.port
const LANG = config.lang
/** The ISO 639-1 code ElevenLabs takes for both speech directions. */
const LANG_CODE = LANG.slice(0, 2).toLowerCase()

/**
 * Who transcribes the microphone. Scribe is billed per second of audio and
 * the app sends it every segment it hears, wake-word chatter included, so it
 * eats a free tier quickly; the browser recogniser costs nothing. Scribe is
 * opt-in with ULTRON_STT=elevenlabs.
 */
const STT_ENGINE = process.env.ULTRON_STT ?? 'browser'


/**
 * A crash here takes the whole assistant down mid-sentence, and most of what
 * can reject is out of our hands — a socket dying under a write, an upstream
 * fetch aborting. Log it and keep serving; the turn that failed will surface
 * its own error to the browser.
 */
process.on('unhandledRejection', (err) => {
  console.error('[ultron] unhandled rejection:', err)
})

/**
 * Who is allowed to talk to this bridge.
 *
 * A WebSocket handshake is not subject to the same-origin policy: the browser
 * sends it on behalf of whatever page asked, no preflight stands in the way,
 * and the page reads every byte that comes back. Without a check here, any tab
 * the user happens to have open could open a socket to ws://localhost:8787,
 * drive the agent with every MCP server on this machine, and read back every
 * token and panel. The Origin header is the only thing that separates our own
 * dev server from someone else's page, so it is checked explicitly.
 *
 * A missing Origin means a non-browser client — curl, a script, a native app.
 * That is also exactly what local malware looks like, so it is refused on the
 * socket unless ULTRON_ALLOW_NO_ORIGIN=1 says otherwise.
 */
const EXTRA_ORIGINS = new Set(
  (process.env.ULTRON_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean),
)
const ALLOW_NO_ORIGIN = process.env.ULTRON_ALLOW_NO_ORIGIN === '1'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Vite takes the next free port when 5173 is busy and `vite preview` starts at
 * 4173, so the dev ranges are allowed rather than two exact numbers. Anything
 * else — including localhost on a port some other app is serving — has to be
 * named in ULTRON_ALLOWED_ORIGINS.
 */
const isDevPort = (port) =>
  (port >= 5173 && port <= 5199) || (port >= 4173 && port <= 4199)

function originAllowed(origin) {
  if (!origin) return ALLOW_NO_ORIGIN
  if (EXTRA_ORIGINS.has(origin.replace(/\/+$/, ''))) return true
  let url
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'http:') return false
  if (!LOCAL_HOSTS.has(url.hostname)) return false
  return isDevPort(Number(url.port))
}

/** Writes, shell and acting on the world wait for this (bridge/policy.ts). */
const ALLOW_WRITES = config.allowWrites
const policy = toolPolicy({ allowWrites: ALLOW_WRITES })

// The voice and the heavy subagent (bridge/config.ts explains the split):
// what .env.local says, unless the L panel's `model` commands chose since.
const ENV_CHOICE = { voice: config.brain.voice, heavy: config.brain.heavy }
const brainFile = brainChoiceFile(ULTRON_DIR)
const START_CHOICE = brainFile.saved() ?? ENV_CHOICE


/**
 * ElevenLabs credentials, borrowed from the MCP server config.
 *
 * If you've set up the elevenlabs MCP server, the key is already on this
 * machine — no reason to make you paste it into a second .env file. The browser
 * never sees it: it POSTs text to /tts here and gets audio back.
 */
function elevenKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY
  try {
    const cfg = JSON.parse(
      readFileSync(join(homedir(), '.claude.json'), 'utf8'),
    )
    return cfg.mcpServers?.elevenlabs?.env?.ELEVENLABS_API_KEY ?? null
  } catch {
    return null
  }
}

const VOICE_ID = process.env.ULTRON_VOICE_ID ?? 'JBFqnCBsd6RMkjVDRZzb'
const TTS_MODEL = 'eleven_flash_v2_5'
/** Flash and Turbo bill half a credit per character; the other models, one. */
const TTS_CREDITS_PER_CHAR = 0.5

/**
 * Credit bookkeeping for the ElevenLabs voice.
 *
 * Flash bills per character, so the fixed lines (fillers, "Sim, senhor?") are
 * kept on disk after their first synthesis and replayed for free. Once the
 * account runs dry the bridge stops calling out for the rest of the run and
 * answers 402 at once, so the app falls back to the system voice without a
 * failed round trip per sentence.
 */
const TTS_CACHE = join(homedir(), '.cache', 'ultron-tts')
/** Only short lines repeat; an answer is never said twice. */
const TTS_CACHE_MAX = 160
let ttsChars = 0
let ttsSpent = false

/** A voice the page asked for by id (the L panel's `voice id`). Checked
 *  because it goes into the upstream URL and the cache key. */
const VOICE_ID_RE = /^[A-Za-z0-9]{8,40}$/

function ttsCachePath(text, voice = VOICE_ID) {
  const id = createHash('sha1')
    .update([voice, TTS_MODEL, LANG_CODE, text].join('\n'))
    .digest('hex')
  return join(TTS_CACHE, `${id}.mp3`)
}

/**
 * Where /file is permitted to read from, and how big a read may get.
 *
 * The roots are realpath'd once at boot so the containment check below compares
 * like with like — on macOS os.tmpdir() is a symlink into /private/var, and a
 * string prefix test against the unresolved form would reject every screenshot.
 */
const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  // .svg is deliberately absent. An SVG is a scriptable document, and this
  // endpoint serves it from the bridge's own origin — the one origin allowed
  // to open the agent socket. A picture is not worth that.
}

const MAX_FILE_BYTES = 25 * 1024 * 1024

const FILE_ROOTS = [
  homedir(),
  // Both temp directories, because on macOS os.tmpdir() is the per-user
  // $TMPDIR under /var/folders while half the tools that take a screenshot
  // still write it to /tmp. Dropping one of them loses real panels.
  tmpdir(),
  '/tmp',
  ...(process.env.ULTRON_FILE_ROOTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
].map((root) => {
  try {
    return realpathSync(root)
  } catch {
    return resolvePath(root)
  }
})

/** True when `real` sits inside one of the roots, after both are resolved. */
const withinRoots = (real) =>
  FILE_ROOTS.some((root) => {
    const rel = relative(root, real)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  })

// ---------------------------------------------------------------------------

/**
 * Remote media, fetched by the bridge instead of by the page.
 *
 * ULTRON used to refuse to show anything he found on the web, and the refusal
 * was not squeamishness — a bare <img src="https://some-cdn/..."> in a panel
 * genuinely did not work. Three reasons, and all three are fixed by moving the
 * fetch to this side of the wire:
 *
 *   1. Hotlink blocking. News sites and image CDNs check Referer and User-Agent
 *      and hand a browser-that-isn't-their-page a 403 or a placeholder. That is
 *      why thumbnails rendered as empty rectangles. A server-side fetch that
 *      looks like an ordinary browser and sends no referrer gets the bytes.
 *   2. Privacy. Panel HTML is authored by a model that has just been reading
 *      untrusted web pages, so a remote URL in it is a prompt-injection beacon:
 *      load it directly and the user's IP, and the fact they asked, go to a host
 *      the page chose. Proxying means the browser only ever talks to localhost
 *      and the page CSP can stay tight.
 *   3. One place to cap size, set timeouts and insist the bytes really are the
 *      media type they claim.
 *
 * The cost is that this process — unlike a browser tab — can reach the user's
 * LAN, their router's admin page, and cloud metadata endpoints. So everything
 * below is an SSRF gate first and a proxy second.
 */

const MAX_IMG_BYTES = 15 * 1024 * 1024
const MAX_MEDIA_BYTES = 200 * 1024 * 1024
const IMG_TIMEOUT_MS = 10_000
const MEDIA_TIMEOUT_MS = 30_000

// The SSRF gate and the guarded outbound clients now live in ./net.mjs, so the
// media proxy below and the page proxy share one implementation of the rules
// rather than two that can drift apart.

/**
 * The shared body of /img and /media.
 *
 * `kinds` is the list of content-type prefixes we are willing to hand back.
 * That check is load-bearing: without it this is an open proxy that will serve
 * an attacker's HTML from the bridge's own origin — the one origin allowed to
 * open the agent socket — which is the same reason IMAGE_TYPES has no .svg.
 */
async function proxyRemote(req, res, cors, { kinds, maxBytes, timeoutMs, ranged }) {
  const asked = new URL(req.url, 'http://x').searchParams.get('url') ?? ''
  const target = vetTarget(asked)

  const headers = {
    'user-agent': PROXY_UA,
    accept: ranged ? '*/*' : 'image/*,*/*;q=0.8',
    // Identity encoding so the byte cap counts the bytes we actually stream and
    // content-length means what it says. Media is already compressed anyway.
    'accept-encoding': 'identity',
  }
  // Range is the difference between a <video> that seeks and one Safari refuses
  // to play at all, so the browser's request is passed through verbatim.
  if (ranged && typeof req.headers.range === 'string') {
    headers.range = req.headers.range
  }

  const { res: upstream } = await openRemote(target, headers, timeoutMs)
  const status = upstream.statusCode ?? 0

  if (status !== 200 && status !== 206) {
    upstream.resume()
    throw proxyError(status === 404 ? 404 : 502, `upstream said ${status}`)
  }

  const type = String(upstream.headers['content-type'] ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (!kinds.some((kind) => type.startsWith(kind))) {
    upstream.resume()
    throw proxyError(415, `not ${kinds.join(' or ')} (got ${type || 'nothing'})`)
  }

  const declared = Number(upstream.headers['content-length'])
  if (Number.isFinite(declared) && declared > maxBytes) {
    upstream.resume()
    throw proxyError(413, 'too large')
  }

  const out = {
    ...cors,
    'content-type': type,
    'x-content-type-options': 'nosniff',
    // Thumbnails get looked at, panelled again, and re-rendered on every HUD
    // repaint; re-fetching from the CDN each time is slow and rude.
    'cache-control': 'private, max-age=600',
  }
  if (Number.isFinite(declared)) out['content-length'] = String(declared)
  if (ranged) {
    // Only claim range support when the origin actually demonstrated it — a
    // 206, or an explicit accept-ranges of its own. Plenty of hosts ignore the
    // Range header and hand back the whole file with a 200; advertising
    // accept-ranges on top of that tells the video element it may seek by
    // issuing byte requests that will never be honoured, and the scrub bar
    // then misbehaves in a way that looks like our bug rather than theirs.
    if (status === 206 || upstream.headers['accept-ranges'] === 'bytes') {
      out['accept-ranges'] = 'bytes'
    }
    if (upstream.headers['content-range']) {
      out['content-range'] = upstream.headers['content-range']
    }
  }
  res.writeHead(status, out)

  // Stream with a running cap. Buffering a 200 MB video into this process
  // would stall the token stream the voice is riding on, and trusting
  // content-length would let a host that lies about it eat the heap.
  let sent = 0
  upstream.on('data', (chunk) => {
    sent += chunk.length
    if (sent > maxBytes) {
      // Headers went out long ago, so a truncated body is the only way left to
      // say no. The player sees a short read; we see this line in the log.
      console.warn(`[ultron] proxy cut ${target.href} at ${maxBytes} bytes`)
      upstream.destroy()
      res.destroy()
      return
    }
    if (!res.write(chunk)) {
      upstream.pause()
      res.once('drain', () => upstream.resume())
    }
  })
  upstream.on('end', () => res.end())
  upstream.on('error', () => res.destroy())
  req.on('close', () => upstream.destroy())
}

// ---------------------------------------------------------------------------

/**
 * CORS, reflected rather than wildcarded.
 *
 * `*` on this origin means any page on the internet can read whatever the
 * bridge serves, so the same allowlist that guards the socket picks the
 * header. A request carrying an Origin we don't know is refused outright —
 * but a request with no Origin at all is served, because an <img src> load
 * (which is how panels fetch screenshots) never sends one.
 */
function corsFor(req) {
  const origin = req.headers.origin
  const headers = { vary: 'origin' }
  if (origin) {
    headers['access-control-allow-origin'] = origin
    headers['access-control-allow-headers'] = 'content-type'
    // The page reads what a speech request cost off these (the log panel).
    headers['access-control-expose-headers'] =
      'x-ultron-chars, x-ultron-credits, x-ultron-cache'
  }
  return headers
}

// One HTTP server for both the speech proxy and the WebSocket upgrade.
const http = await import('node:http')

const handleRequest = async (req, res) => {
  const origin = req.headers.origin
  const remote = isRemote(req)
  // Through the /bridge proxy the page shares the bridge's origin, which the
  // remote gate checks instead of the local dev-port list.
  if (origin && !(remote ? sameOrigin(req, origin) : originAllowed(origin))) {
    console.warn(`[ultron] refused http request from origin ${origin}`)
    res.writeHead(403, { vary: 'origin' })
    return res.end('forbidden')
  }
  const cors = corsFor(req)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    return res.end()
  }

  // Login comes before the gate: a page that is not logged in has to be able
  // to find that out and fix it (bridge/auth.mjs).
  const route = (req.url ?? '').split('?')[0]
  if (route === '/auth' || route === '/login') {
    if (await handleAuth(req, res, cors)) return
  }
  const gated = gate(req)
  if (!gated.ok) {
    res.writeHead(gated.why === 'login required' ? 401 : 403, {
      ...cors,
      'content-type': 'application/json',
    })
    return res.end(JSON.stringify({ error: gated.why }))
  }

  if (route === '/memory' || route === '/memory/reset') {
    return handleMemory(req, res, cors)
  }
  if (route === '/brain') return handleBrain(req, res, cors)

  if (req.method === 'GET' && req.url === '/health') {
    // The browser reads this once at boot to decide which voice engine to use.
    // Both premium paths ride the same ElevenLabs key, so both flags track it:
    // with a key the app transcribes with Scribe and speaks with ElevenLabs;
    // without one it falls back to the browser's own recogniser and voice, so a
    // student with nothing configured still has a working assistant.
    const eleven = Boolean(elevenKey())
    res.writeHead(200, { ...cors, 'content-type': 'application/json' })
    return res.end(
      JSON.stringify({
        ok: true,
        tts: eleven && !ttsSpent,
        stt: eleven && STT_ENGINE === 'elevenlabs',
        lang: LANG,
        shell: shellInfo(),
      }),
    )
  }

  // The L panel's `!` commands (bridge/shell.mjs). Off unless
  // ULTRON_ALLOW_SHELL=1, and only ever for this machine.
  if (req.method === 'POST' && req.url === '/shell') {
    return handleShell(req, res, cors)
  }

  // The real ElevenLabs balance, for the page's log panel. Needs a key allowed
  // to read the user's subscription; a restricted key answers an error, which
  // the panel shows as "saldo indisponível" and carries on without.
  if (req.method === 'GET' && req.url === '/usage') {
    const key = elevenKey()
    const json = { ...cors, 'content-type': 'application/json' }
    if (!key) {
      res.writeHead(200, json)
      return res.end(JSON.stringify({ error: 'no key' }))
    }
    try {
      const upstream = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
        headers: { 'xi-api-key': key },
      })
      if (!upstream.ok) {
        res.writeHead(200, json)
        return res.end(JSON.stringify({ error: `elevenlabs ${upstream.status}` }))
      }
      const s = await upstream.json()
      res.writeHead(200, json)
      return res.end(
        JSON.stringify({
          used: s.character_count,
          limit: s.character_limit,
          tier: s.tier,
          resetsAt: s.next_character_count_reset_unix ?? null,
        }),
      )
    } catch (err) {
      res.writeHead(200, json)
      return res.end(JSON.stringify({ error: String(err?.message ?? err) }))
    }
  }

  // The voices on the ElevenLabs account, for the L panel's `voice list`. Like
  // /usage, a restricted key may be refused; the panel says so and carries on.
  if (req.method === 'GET' && req.url === '/voices') {
    const key = elevenKey()
    const json = { ...cors, 'content-type': 'application/json' }
    if (!key) {
      res.writeHead(200, json)
      return res.end(JSON.stringify({ error: 'no key', default: VOICE_ID }))
    }
    try {
      const upstream = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': key },
      })
      if (!upstream.ok) {
        res.writeHead(200, json)
        return res.end(JSON.stringify({ error: `elevenlabs ${upstream.status}`, default: VOICE_ID }))
      }
      const { voices = [] } = await upstream.json()
      res.writeHead(200, json)
      return res.end(
        JSON.stringify({
          default: VOICE_ID,
          voices: voices.map((v) => ({
            id: v.voice_id,
            name: v.name,
            category: v.category ?? '',
            labels: Object.values(v.labels ?? {}).filter((x) => typeof x === 'string'),
          })),
        }),
      )
    } catch (err) {
      res.writeHead(200, json)
      return res.end(JSON.stringify({ error: String(err?.message ?? err), default: VOICE_ID }))
    }
  }

  // Serve local image files to the page. Screenshots and generated art land on
  // disk as absolute paths, and a page served over http can't read file:// —
  // so the bridge, which can, hands them over.
  if (req.method === 'GET' && req.url?.startsWith('/file?')) {
    const asked = new URL(req.url, 'http://x').searchParams.get('path') ?? ''
    // Resolve symlinks BEFORE judging anything. A name ending in .png can be a
    // link pointing at /etc/hosts, and checking the suffix the caller supplied
    // would wave that straight through — which is exactly how this endpoint
    // used to serve the contents of arbitrary system files.
    let real = null
    try {
      if (isAbsolute(asked)) real = await realpath(asked)
    } catch {
      real = null
    }
    const dot = real ? real.lastIndexOf('.') : -1
    const ext = dot === -1 ? '' : real.slice(dot).toLowerCase()
    // Images only, absolute paths only, and only under roots we expect things
    // to be written to. This endpoint exists to show pictures, not to be a
    // general file read for whatever the model — or another page — asks for.
    if (!real || !Object.hasOwn(IMAGE_TYPES, ext) || !withinRoots(real)) {
      res.writeHead(400, cors)
      return res.end('images only')
    }
    try {
      const info = await stat(real)
      if (!info.isFile() || info.size > MAX_FILE_BYTES) {
        res.writeHead(413, cors)
        return res.end('too large')
      }
      // Asynchronous because this process is also pumping the agent's token
      // stream; a synchronous read of a large screenshot stalls the voice.
      const body = await readFile(real)
      res.writeHead(200, {
        ...cors,
        'content-type': IMAGE_TYPES[ext],
        'x-content-type-options': 'nosniff',
      })
      return res.end(body)
    } catch {
      res.writeHead(404, cors)
      return res.end('not found')
    }
  }

  // Remote images, fetched here so the page never talks to the wider web. The
  // renderer rewrites every http(s) <img src> in a panel to this endpoint.
  if (req.method === 'GET' && req.url?.startsWith('/img?')) {
    try {
      await proxyRemote(req, res, cors, {
        kinds: ['image/'],
        maxBytes: MAX_IMG_BYTES,
        timeoutMs: IMG_TIMEOUT_MS,
        ranged: false,
      })
    } catch (err) {
      if (res.headersSent) return res.destroy()
      res.writeHead(err.status ?? 502, cors)
      return res.end(err.message ?? 'proxy failed')
    }
    return
  }

  // The same, for video and audio. Separate from /img because the limits and
  // the Range handling are genuinely different, not because the code is.
  if (req.method === 'GET' && req.url?.startsWith('/media?')) {
    try {
      await proxyRemote(req, res, cors, {
        kinds: ['video/', 'audio/'],
        maxBytes: MAX_MEDIA_BYTES,
        timeoutMs: MEDIA_TIMEOUT_MS,
        ranged: true,
      })
    } catch (err) {
      if (res.headersSent) return res.destroy()
      res.writeHead(err.status ?? 502, cors)
      return res.end(err.message ?? 'proxy failed')
    }
    return
  }

  // A whole web page, fetched here and served from this origin so it can be
  // framed. The publisher's X-Frame-Options and CORS rules are enforced against
  // the browser, and from the browser's point of view this document is ours —
  // so an article that refuses to be embedded anywhere still opens on the
  // display. See page.mjs for what each mode does to the markup.
  //
  // No Origin header arrives on an iframe navigation, so this rides the same
  // path as an <img> load through the check at the top of this handler.
  if (req.method === 'GET' && req.url?.startsWith('/page?')) {
    const asked = new URL(req.url, 'http://x')
    const target = asked.searchParams.get('url') ?? ''
    const mode = asked.searchParams.get('mode') === 'live' ? 'live' : 'reader'
    try {
      const page = await renderPage(
        target,
        mode,
        isRemote(req) ? publicOrigin(req) : `http://localhost:${PORT}`,
      )
      res.writeHead(200, { ...cors, ...page.headers })
      return res.end(page.body)
    } catch (err) {
      // Rendered as a page rather than returned as a status, because this lands
      // inside an iframe: a bare 502 body is a blank rectangle on the display,
      // which reads as the interface being broken rather than as the article
      // being unavailable.
      res.writeHead(err.status ?? 502, {
        ...cors,
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      })
      return res.end(
        `<!doctype html><meta charset="utf-8"><style>
           body{margin:0;padding:26px;background:transparent;color:#7fb6bf;
                font:400 13px/1.6 ui-monospace,monospace}
           b{color:#cfe9ee;font-weight:500;display:block;margin-bottom:6px}
         </style><b>This page could not be opened.</b>${
           String(err?.message ?? 'unknown error').replace(/[<&]/g, '')
         }`,
      )
    }
  }

  if (req.method === 'POST' && req.url === '/tts') {
    const key = elevenKey()
    if (!key) {
      res.writeHead(503, cors)
      return res.end('no elevenlabs key')
    }
    // A spoken line is a few hundred bytes. Anything approaching this is not a
    // sentence, and buffering it unbounded would let one request eat the heap.
    let body = ''
    let overflowed = false
    for await (const chunk of req) {
      body += chunk
      if (body.length > 64 * 1024) {
        overflowed = true
        break
      }
    }
    if (overflowed) {
      req.destroy()
      res.writeHead(400, cors)
      return res.end('body too large')
    }
    // Inside a try: this handler is async with nothing catching its rejection,
    // so a malformed body used to take the entire bridge down with it.
    let text
    let voice
    try {
      ;({ text, voice } = JSON.parse(body || '{}'))
    } catch {
      res.writeHead(400, cors)
      return res.end('bad json')
    }
    if (!text) {
      res.writeHead(400, cors)
      return res.end('no text')
    }
    if (voice != null && !(typeof voice === 'string' && VOICE_ID_RE.test(voice))) {
      res.writeHead(400, cors)
      return res.end('bad voice id')
    }
    const voiceId = voice || VOICE_ID
    const cacheable = text.length <= TTS_CACHE_MAX
    const cached = cacheable ? ttsCachePath(text, voiceId) : null
    if (cached) {
      const hit = await readFile(cached).catch(() => null)
      if (hit) {
        res.writeHead(200, {
          ...cors,
          'content-type': 'audio/mpeg',
          'x-ultron-chars': String(text.length),
          'x-ultron-credits': '0',
          'x-ultron-cache': 'hit',
        })
        return res.end(hit)
      }
    }
    if (ttsSpent) {
      res.writeHead(402, cors)
      return res.end('elevenlabs credits exhausted')
    }
    try {
      const upstream = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream` +
          // 22kHz mono is half the bytes of 44kHz and indistinguishable through
          // a laptop speaker; optimize_streaming_latency=3 trades a little
          // prosody for a much earlier first byte.
          `?output_format=mp3_22050_32&optimize_streaming_latency=3`,
        {
          method: 'POST',
          headers: { 'xi-api-key': key, 'content-type': 'application/json' },
          body: JSON.stringify({
            text,
            // Flash is the low-latency model — a conversation needs speed more
            // than it needs the last few percent of quality.
            model_id: TTS_MODEL,
            // Pins the accent. Without it Flash guesses the language from
            // each sentence, and a short line with an English tool name in it
            // comes out in English.
            language_code: LANG_CODE,
            voice_settings: {
              stability: 0.4,
              similarity_boost: 0.75,
              speed: 1.05,
            },
          }),
        },
      )
      if (!upstream.ok) {
        const detail = await upstream.text()
        if (/quota_exceeded|insufficient|credits/i.test(detail)) {
          ttsSpent = true
          console.warn('[ultron] ElevenLabs credits exhausted; system voice from now on')
        }
        res.writeHead(upstream.status, cors)
        return res.end(detail)
      }
      ttsChars += text.length
      console.log(`[ultron] tts ${text.length} chars (${ttsChars} this run)`)

      // Pipe it through rather than buffering. Waiting for the whole file here
      // would throw away everything the streaming endpoint just bought us.
      res.writeHead(200, {
        ...cors,
        'content-type': 'audio/mpeg',
        'cache-control': 'no-cache',
        'x-ultron-chars': String(text.length),
        'x-ultron-credits': String(text.length * TTS_CREDITS_PER_CHAR),
        'x-ultron-cache': 'miss',
      })
      const parts = []
      for await (const chunk of upstream.body) {
        const buf = Buffer.from(chunk)
        res.write(buf)
        if (cached) parts.push(buf)
      }
      res.end()
      if (cached) {
        await mkdir(TTS_CACHE, { recursive: true })
          .then(() => writeFile(cached, Buffer.concat(parts)))
          .catch(() => {})
      }
      return
    } catch (err) {
      res.writeHead(502, cors)
      return res.end(String(err?.message ?? err))
    }
  }

  // Speech to text. The browser captures one spoken segment as a compressed
  // audio blob and posts the raw bytes here; the bridge hands them to
  // ElevenLabs Scribe and returns the transcript. This is what replaced the
  // browser's own SpeechRecognition — that API dies silently under always-on
  // use, and a server-side transcriber cannot. Detecting that the user is
  // speaking at all is done locally with voice-activity detection, which never
  // touches this endpoint; this is only for the words.
  if (req.method === 'POST' && req.url === '/stt') {
    const key = elevenKey()
    if (!key) {
      res.writeHead(503, cors)
      return res.end('no elevenlabs key')
    }

    const type = req.headers['content-type'] || 'audio/webm'
    const chunks = []
    let size = 0
    let overflowed = false
    // A few seconds of Opus is well under a megabyte; 25 MB is a generous
    // ceiling that still refuses a runaway stream before it eats the heap.
    for await (const chunk of req) {
      chunks.push(chunk)
      size += chunk.length
      if (size > 25 * 1024 * 1024) {
        overflowed = true
        break
      }
    }
    if (overflowed) {
      req.destroy()
      res.writeHead(413, cors)
      return res.end('audio too large')
    }
    // Silence, or a click. Nothing to transcribe, and calling out to the API
    // for it would only add latency to a non-answer.
    if (size < 1200) {
      res.writeHead(200, { ...cors, 'content-type': 'application/json' })
      return res.end(JSON.stringify({ text: '' }))
    }

    try {
      // The filename extension is the only hint Scribe gets about the codec, so
      // derive it from the content-type the MediaRecorder reported rather than
      // hard-coding one.
      const ext = type.includes('ogg')
        ? 'ogg'
        : type.includes('mp4') || type.includes('mpeg')
          ? 'mp4'
          : type.includes('wav')
            ? 'wav'
            : 'webm'
      const form = new FormData()
      form.append('model_id', 'scribe_v1')
      form.append('language_code', LANG_CODE)
      form.append(
        'file',
        new Blob([Buffer.concat(chunks)], { type }),
        `speech.${ext}`,
      )

      const upstream = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: { 'xi-api-key': key },
        body: form,
      })
      if (!upstream.ok) {
        res.writeHead(upstream.status, cors)
        return res.end(await upstream.text())
      }
      const data = await upstream.json()
      res.writeHead(200, { ...cors, 'content-type': 'application/json' })
      return res.end(JSON.stringify({ text: (data.text ?? '').trim() }))
    } catch (err) {
      res.writeHead(502, cors)
      return res.end(String(err?.message ?? err))
    }
  }

  res.writeHead(404, cors)
  res.end()
}

const server = http.createServer((req, res) => {
  // The handler is async, so anything it throws would otherwise become an
  // unhandled rejection and leave the browser waiting on a socket that is
  // never going to answer.
  handleRequest(req, res).catch((err) => {
    console.error('[ultron] request failed:', err)
    if (!res.headersSent) res.writeHead(500)
    res.end()
  })
})

const wss = new WebSocketServer({
  server,
  // The handshake is the only place a page can be turned away, so it happens
  // here rather than after the socket is open. Rejections are logged loudly:
  // the likeliest cause is a dev server on an unexpected port, and a silent
  // 403 would look like the bridge simply isn't running.
  verifyClient: ({ origin, req }, done) => {
    const path = (req.url ?? '/').split('?')[0]
    if (path !== '/' && path !== '/ws') {
      console.warn(`[ultron] rejected websocket on path ${path}`)
      return done(false, 403, 'Forbidden')
    }
    const gated = gate(req)
    if (!gated.ok) {
      console.warn(`[ultron] rejected remote websocket: ${gated.why}`)
      return done(false, gated.why === 'login required' ? 401 : 403, 'Forbidden')
    }
    if (!gated.remote && !originAllowed(origin)) {
      console.warn(
        `[ultron] rejected websocket from origin ${origin ?? '(none)'}` +
          ' — set ULTRON_ALLOWED_ORIGINS to permit it',
      )
      return done(false, 403, 'Forbidden')
    }
    done(true)
  },
})
// Anything that does not arrive straight from this machine, the proxy and
// the local network alike, goes through the password gate in bridge/auth.mjs.
server.listen(PORT)

console.log(`[ultron] bridge listening on ws://localhost:${PORT}`)
console.log(
  remoteEnabled()
    ? '[ultron] remote access ON — other devices log in with ULTRON_PASSWORD through /bridge'
    : '[ultron] remote access off — set ULTRON_PASSWORD to reach Ultron from other devices',
)
console.log(
  `[ultron] language ${LANG} · voice ${elevenKey() ? 'ElevenLabs' : 'browser'} · ` +
    `hearing ${elevenKey() && STT_ENGINE === 'elevenlabs' ? 'ElevenLabs Scribe' : 'browser'}`,
)
console.log(
  `[ultron] brain ${config.brain.kind} · model ${START_CHOICE.voice.model} · effort ${START_CHOICE.voice.effort}` +
    (START_CHOICE.heavy ? ` · heavy ${START_CHOICE.heavy.model} · effort ${START_CHOICE.heavy.effort}` : ''),
)
console.log(
  `[ultron] writes ${ALLOW_WRITES ? 'ENABLED' : 'disabled'}` +
    (ALLOW_WRITES ? '' : ' — set ULTRON_ALLOW_WRITES=1 to permit shell/file/device actions'),
)
// Asynchronous, so it lands a beat after the rest of the banner. Worth printing
// at all because an extension that is simply not running is indistinguishable
// at the tool boundary from one that is broken, and this is the one place the
// difference can be stated before anybody asks a question that depends on it.
void chromeAvailable().then((ok) => {
  console.log(
    ok
      ? `[ultron] browser control ready${ALLOW_WRITES ? '' : ' (reading only — clicking and typing need ULTRON_ALLOW_WRITES=1)'}`
      : '[ultron] browser control unavailable — open Chrome with the Claude extension enabled',
  )
})

console.log(
  '[ultron] accepting local dev origins' +
    (EXTRA_ORIGINS.size ? ` plus ${[...EXTRA_ORIGINS].join(', ')}` : '') +
    (ALLOW_NO_ORIGIN ? ' and clients that send no origin' : ''),
)

// The brain, and the one conversation every app shares (bridge/conversation.ts).
const devices = new Devices()
// The persona: what Ultron is and how he talks, for the voice and for the heavy subagent.
const brain = claudeAgentBrain({
  settings: { ...config.brain, ...START_CHOICE },
  persona: (heavy) => personaPrompts({ lang: LANG, heavy }),
  debug: config.debug,
})
// Long-term memory, when an ai-memory server is configured (bridge/config.ts).
const longMemory = config.memory ? aiMemory(config.memory) : null
const conversations = new ConversationSlot({
  brain,
  devices,
  policy,
  memory: { saved: savedConversation, remember: rememberConversation, forget: forgetConversation },
  ownTools: (io) => ownTools({ ...io, allowWrites: ALLOW_WRITES, home: homedir(), memory: longMemory }),
})
const handleBrain = brainRoute({ brain, conversations, devices, file: brainFile, defaults: ENV_CHOICE })

// Checked at startup for the same reason as the browser: a memory server that
// is not running looks, from inside a turn, exactly like one with nothing in it.
void memoryBanner(longMemory, config.memory).then((line) => console.log(line))

wss.on('connection', (socket) => {
  console.log(`[ultron] client connected (${devices.size + 1} now)`)
  devices.add(socket)

  // Answer the HUD straight away rather than making it wait for the brain's
  // first turn. Refined later by the real init message.
  socket.send(
    JSON.stringify({ type: 'ready', servers: conversations.liveServers ?? brain.knownServers() }),
  )
  // Started now rather than at the first question, so the saved conversation
  // is already loaded by the time anyone speaks.
  conversations.now()

  socket.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    if (msg.type === 'ask' && typeof msg.text === 'string') {
      // The mood the app read as the question left (src/lib/tone.ts), set in
      // front of it the way the persona is told to expect. Capped because it
      // arrives over the socket like anything else.
      const tone = typeof msg.tone === 'string' ? msg.tone.trim().slice(0, 400) : ''
      const text = tone ? `<mood>${tone}</mood>\n${msg.text}` : msg.text
      const id = typeof msg.id === 'string' ? msg.id : null
      conversations.now().question(socket, text, id, msg.text)
    }

    if (msg.type === 'reply' && typeof msg.id === 'string') {
      conversations.running?.reply(msg)
    }

    if (msg.type === 'interrupt') {
      conversations.running?.interrupt()
    }
  })

  socket.on('close', () => {
    devices.remove(socket)
    conversations.running?.leave(socket)
    console.log(`[ultron] client disconnected (${devices.size} left)`)
  })
})

/**
 * GET /memory — the conversation Ultron is in, for the L panel.
 * POST /memory/reset — start a new one. The old transcript stays in the SDK's
 * own store on disk; Ultron just stops resuming it.
 */
async function handleMemory(req, res, cors) {
  const json = { ...cors, 'content-type': 'application/json' }
  const route = (req.url ?? '').split('?')[0]
  if (req.method === 'GET' && route === '/memory') {
    const saved = savedConversation()
    res.writeHead(200, json)
    return res.end(
      JSON.stringify({
        id: saved?.id ?? null,
        since: saved?.since ?? null,
        turns: saved?.turns ?? 0,
        devices: devices.size,
      }),
    )
  }
  if (req.method === 'POST' && route === '/memory/reset') {
    conversations.reset()
    console.log('[ultron] memory reset: next question starts a new conversation')
    // Every app clears its transcript, since none of it is remembered now.
    devices.broadcast({ type: 'ui', op: 'screen', args: { what: 'transcript' } })
    if (devices.size) conversations.now()
    res.writeHead(200, json)
    return res.end(JSON.stringify({ ok: true }))
  }
  res.writeHead(405, json)
  return res.end(JSON.stringify({ error: 'method not allowed' }))
}
