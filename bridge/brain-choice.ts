/**
 * Which models the brain runs on, and how the L panel's `model`, `effort` and
 * `heavy` commands change them.
 *
 * .env.local says where Ultron starts. A change typed in the terminal is kept
 * on disk (brain-choice-file.ts) and wins over .env.local until `model reset`.
 */
import { z } from 'zod'
import { EFFORTS, type ModelChoice } from './config.ts'

/** The voice and the heavy subagent it hands long work to (null when there is none). */
export interface BrainChoice {
  voice: ModelChoice
  heavy: ModelChoice | null
}

/** Short names the terminal accepts, so nobody has to type a full id. */
export const MODEL_ALIASES: Readonly<Record<string, string>> = {
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
  haiku: 'claude-haiku-5-5',
}

const MODEL_ID = /^claude-[a-z0-9][a-z0-9.-]*(\[1m\])?$/

const modelName = z
  .string()
  .trim()
  .toLowerCase()
  .transform((name) => MODEL_ALIASES[name] ?? name)
  .refine((id) => MODEL_ID.test(id), {
    error: (issue) =>
      `model "${String(issue.input)}" is not a Claude model id (claude-...) ` +
      `nor one of: ${Object.keys(MODEL_ALIASES).join(', ')}`,
  })

const effort = z.enum(EFFORTS, { error: (issue) => `effort "${String(issue.input)}" must be one of: ${EFFORTS.join(', ')}` })

const modelChange = z.strictObject({ model: modelName.optional(), effort: effort.optional() })

const brainChange = z.strictObject({
  voice: modelChange.optional(),
  heavy: z.union([z.literal('off'), modelChange]).optional(),
  reset: z.literal(true).optional(),
})

/** What one terminal command asks to change. Anything left out stays as it is. */
export type BrainChange = z.infer<typeof brainChange>

/**
 * Reads a change sent by the terminal, or throws naming what was wrong.
 *
 * @example
 *   parseBrainChange({ voice: { model: 'opus' } })  // { voice: { model: 'claude-opus-5-5' } }
 */
export function parseBrainChange(body: unknown): BrainChange {
  const parsed = brainChange.safeParse(body)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  const where = issue?.path.length ? `${issue.path.join('.')}: ` : ''
  throw new Error(`${where}${issue?.message ?? 'not a brain change'}`)
}

/** A saved choice, as read back from disk. */
export const brainChoiceSchema = z.strictObject({
  voice: z.strictObject({ model: z.string().regex(MODEL_ID), effort }),
  heavy: z.strictObject({ model: z.string().regex(MODEL_ID), effort }).nullable(),
})

function nextHeavy(current: ModelChoice | null, change: BrainChange['heavy'], fallback: ModelChoice | null): ModelChoice | null {
  if (change === undefined) return current
  if (change === 'off') return null
  if (current) return { ...current, ...change }
  if (!change.model) throw new Error('heavy is off: name a model to turn it on, as in "heavy opus"')
  return { effort: fallback?.effort ?? 'high', ...change, model: change.model }
}

/**
 * The choice after a change. `defaults` is what .env.local says: `reset`
 * goes back to it, and a heavy subagent turned back on takes its effort.
 *
 * @example
 *   nextChoice(current, { heavy: 'off' }, defaults)  // current, without the subagent
 */
export function nextChoice(current: BrainChoice, change: BrainChange, defaults: BrainChoice): BrainChoice {
  if (change.reset) return defaults
  return {
    voice: { ...current.voice, ...change.voice },
    heavy: nextHeavy(current.heavy, change.heavy, defaults.heavy),
  }
}

/** Whether two choices run the same models at the same effort. */
export function sameChoice(a: BrainChoice, b: BrainChoice): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** "sonnet-5-5 low · heavy opus-5-5 high", for logs. */
export function describeChoice(choice: BrainChoice): string {
  const name = (c: ModelChoice) => `${c.model.replace(/^claude-/, '')} ${c.effort}`
  return `${name(choice.voice)} · heavy ${choice.heavy ? name(choice.heavy) : 'off'}`
}
