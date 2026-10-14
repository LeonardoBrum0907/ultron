/**
 * The words of the `model`, `effort` and `heavy` commands, as the change they
 * ask the bridge for (POST /brain, bridge/brain-route.ts).
 *
 * No checking of names here: the bridge reads the change and answers with what
 * was wrong, so the rules live in one place (bridge/brain-choice.ts).
 */

export type ModelChoiceShown = { model: string; effort: string }

/** The models in use, as GET /brain and the `brain` frame carry them. */
export type BrainShown = { voice: ModelChoiceShown; heavy: ModelChoiceShown | null }

type ModelChange = { model?: string; effort?: string }

/** The body of a POST /brain. */
export type BrainChangeBody = { voice?: ModelChange; heavy?: ModelChange | 'off'; reset?: true }

/** What a line asks for: to see the models, a change, or nothing (it was wrong). */
export type BrainAsk = { show: true } | { change: BrainChangeBody } | { usage: string }

export const BRAIN_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

export const MODEL_SHORT_NAMES = ['sonnet', 'opus', 'haiku']

const modelAndEffort = ([model, effort]: string[]): ModelChange => (effort ? { model, effort } : { model })

function modelWords(args: string[]): BrainAsk {
  if (!args.length) return { show: true }
  if (args[0] === 'reset' && args.length === 1) return { change: { reset: true } }
  if (args.length > 2) return { usage: 'model [name [effort]] | model reset' }
  return { change: { voice: modelAndEffort(args) } }
}

function effortWords(args: string[]): BrainAsk {
  if (!args.length) return { show: true }
  if (args.length > 1) return { usage: 'effort [level]' }
  return { change: { voice: { effort: args[0] } } }
}

function heavyWords(args: string[]): BrainAsk {
  if (!args.length) return { show: true }
  if (args[0] === 'off' && args.length === 1) return { change: { heavy: 'off' } }
  if (args[0] === 'effort' && args.length === 2) return { change: { heavy: { effort: args[1] } } }
  if (args[0] === 'effort' || args.length > 2) return { usage: 'heavy [name [effort]] | heavy effort <level> | heavy off' }
  return { change: { heavy: modelAndEffort(args) } }
}

/**
 * @example
 *   brainAsk('model', ['opus', 'high'])  // { change: { voice: { model: 'opus', effort: 'high' } } }
 *   brainAsk('heavy', [])                // { show: true }
 */
export function brainAsk(command: 'model' | 'effort' | 'heavy', args: string[]): BrainAsk {
  const words = args.map((w) => w.toLowerCase())
  if (command === 'model') return modelWords(words)
  if (command === 'effort') return effortWords(words)
  return heavyWords(words)
}

/** claude-sonnet-5-5 low → "sonnet-5-5 low". */
const shown = (c: ModelChoiceShown) => `${c.model.replace(/^claude-/, '')} ${c.effort}`

/** The models as the log shows them, one line each. */
export function brainLines(brain: BrainShown): string[] {
  return [`voice  ${shown(brain.voice)}`, `heavy  ${brain.heavy ? shown(brain.heavy) : 'off'}`]
}
