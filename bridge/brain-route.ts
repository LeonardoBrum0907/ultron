/**
 * GET /brain and POST /brain: the models Ultron runs on, for the L panel's
 * `model`, `effort` and `heavy` commands.
 *
 * Any logged-in app can read them, so the phone can see which model is
 * answering. Only this machine can change them: a change is money spent (Opus
 * costs more than Sonnet, and the first answer after a switch rereads the
 * whole conversation without the prompt cache), so it is held to the same
 * standard as the shell (bridge/shell.mjs), at Léo's call.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isRemote } from './auth.mjs'
import type { Brain } from './brain/brain.ts'
import type { BrainChoiceFile } from './brain-choice-file.ts'
import { describeChoice, nextChoice, parseBrainChange, sameChoice, type BrainChoice } from './brain-choice.ts'
import type { ConversationSlot } from './conversation.ts'
import type { Devices } from './devices.ts'

export interface BrainRouteDeps {
  brain: Brain
  conversations: ConversationSlot
  devices: Devices
  file: BrainChoiceFile
  /** What .env.local says, for `model reset`. */
  defaults: BrainChoice
}

type Headers = Record<string, string>

/** A page on this machine (not another device, not the /bridge proxy) that sent an Origin, so a preflight ran. */
function onThisMachine(req: IncomingMessage): boolean {
  return !isRemote(req) && Boolean(req.headers.origin)
}

function send(res: ServerResponse, headers: Headers, status: number, body: object): void {
  res.writeHead(status, { ...headers, 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** A change is a few words; anything bigger is not one. */
const BODY_LIMIT = 4096

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > BODY_LIMIT) throw new Error(`the body is over ${BODY_LIMIT} bytes`)
  }
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`the body is not JSON: ${raw.slice(0, 80)}`)
  }
}

const current = (brain: Brain): BrainChoice => ({ voice: brain.voice, heavy: brain.heavy })

/** Saves the choice now, and switches once the turn in flight (if any) has ended. */
function switchTo(deps: BrainRouteDeps, next: BrainChoice, reset: boolean): void {
  if (reset) deps.file.clear()
  else deps.file.save(next)
  void deps.conversations.reopen(() => {
    deps.brain.choose(next)
    console.log(`[ultron] brain now ${describeChoice(next)}`)
    deps.devices.broadcast({ type: 'brain', ...next })
  })
}

async function changeBrain(deps: BrainRouteDeps, req: IncomingMessage, res: ServerResponse, headers: Headers) {
  let next: BrainChoice
  let reset: boolean
  try {
    const change = parseBrainChange(await readJson(req))
    reset = change.reset === true
    next = nextChoice(current(deps.brain), change, deps.defaults)
  } catch (err) {
    return send(res, headers, 400, { error: (err as Error).message })
  }
  if (sameChoice(next, current(deps.brain)) && !reset) return send(res, headers, 200, { ...next, changed: false })
  // Read before the switch: with a turn in flight, the switch waits for it.
  const waiting = deps.conversations.running?.idle === false
  switchTo(deps, next, reset)
  return send(res, headers, 200, { ...next, changed: true, waiting })
}

/**
 * @example
 *   const handleBrain = brainRoute({ brain, conversations, devices, file, defaults })
 *   if (route === '/brain') return handleBrain(req, res, cors)
 */
export function brainRoute(deps: BrainRouteDeps) {
  return async (req: IncomingMessage, res: ServerResponse, headers: Headers): Promise<void> => {
    if (req.method === 'GET') return send(res, headers, 200, { ...current(deps.brain), saved: deps.file.saved() !== null })
    if (req.method !== 'POST') return send(res, headers, 405, { error: 'method not allowed' })
    if (!onThisMachine(req)) return send(res, headers, 403, { error: 'the brain only changes from this machine' })
    return changeBrain(deps, req, res, headers)
  }
}
