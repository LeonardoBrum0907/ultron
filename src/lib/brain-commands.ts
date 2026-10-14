/**
 * `model`, `effort` and `heavy`: which models Ultron thinks with, read and
 * changed in the bridge (GET and POST /brain).
 *
 * Any device can look; only the PC changes them, because a change is money
 * (Opus costs more, and the first answer after a switch rereads the whole
 * conversation without the cache). The bridge enforces that and answers the
 * phone with why. A switch never cuts an answer short: it waits for the one
 * in flight, and the conversation carries on.
 */
import { BRIDGE_HTTP_URL } from '../config'
import { BRAIN_EFFORTS, MODEL_SHORT_NAMES, brainAsk, brainLines, type BrainChangeBody, type BrainShown } from './brain-words'
import { out, type Command } from './terminal-command'

type BrainReply = BrainShown & { changed?: boolean; waiting?: boolean; saved?: boolean; error?: string }

async function callBrain(change?: BrainChangeBody): Promise<BrainReply | null> {
  try {
    const res = await fetch(`${BRIDGE_HTTP_URL}/brain`, {
      method: change ? 'POST' : 'GET',
      headers: change ? { 'content-type': 'application/json' } : undefined,
      body: change ? JSON.stringify(change) : undefined,
    })
    return (await res.json()) as BrainReply
  } catch {
    out('bridge unreachable', 'error')
    return null
  }
}

function report(reply: BrainReply, changing: boolean): void {
  if (reply.error) return out(reply.error, 'warn')
  for (const line of brainLines(reply)) out(line)
  if (!changing) return out(reply.saved ? 'chosen here (model reset goes back to .env.local)' : 'from .env.local')
  if (reply.changed === false) return out('already so: nothing changed')
  out(reply.waiting ? 'switching after the answer in flight' : 'switched: the conversation carries on')
}

async function runBrain(command: 'model' | 'effort' | 'heavy', args: string[]): Promise<void> {
  const ask = brainAsk(command, args)
  if ('usage' in ask) return out(`usage: ${ask.usage}`, 'warn')
  const change = 'change' in ask ? ask.change : undefined
  const reply = await callBrain(change)
  if (reply) report(reply, change !== undefined)
}

/** The `brain` frame: a switch has landed, typed here or on another device. */
export function logBrainSwitch(brain: BrainShown): void {
  out(`brain switched · ${brainLines(brain).join(' · ')}`)
}

export const BRAIN_COMMANDS: Command[] = [
  {
    name: 'model',
    usage: 'model [name [effort] | reset]',
    summary: 'the model that answers, or switch it',
    details: [
      'model               voice and heavy models, and where the choice came from',
      'model opus          switch the voice to Opus (sonnet, opus, haiku or a full claude-... id)',
      'model opus high     the model and its effort at once',
      'model reset         back to .env.local, voice and heavy',
      'Only from the PC. The first answer after a switch costs more: no cache yet.',
    ],
    complete: (i) => (i === 0 ? [...MODEL_SHORT_NAMES, 'reset'] : i === 1 ? BRAIN_EFFORTS : []),
    run: (args) => runBrain('model', args),
  },
  {
    name: 'effort',
    usage: 'effort [level]',
    summary: 'how hard the voice thinks: low, medium, high, xhigh, max',
    complete: (i) => (i === 0 ? BRAIN_EFFORTS : []),
    run: (args) => runBrain('effort', args),
  },
  {
    name: 'heavy',
    usage: 'heavy [name [effort] | effort <level> | off]',
    summary: 'the subagent the voice hands long work to',
    details: [
      'heavy               its model and effort',
      'heavy opus high     switch it (sonnet, opus, haiku or a full claude-... id)',
      'heavy effort max    only its effort',
      'heavy off           no subagent: the voice does everything itself',
    ],
    complete: (i, args) =>
      i === 0 ? [...MODEL_SHORT_NAMES, 'effort', 'off'] : i === 1 && args[0] !== 'off' ? BRAIN_EFFORTS : [],
    run: (args) => runBrain('heavy', args),
  },
]
