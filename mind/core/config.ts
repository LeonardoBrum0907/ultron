// The body's vocabulary, and the small tools for editing a personality live.
import type { ChannelKind, Track } from './types.ts'

/** An emotion stands out (is dominant, favours a style) only above this. */
export const STANDS_OUT = 0.35

/** The promises to the user when it is called, whatever the personality says. */
export const ACK_WITHIN = 0.2 // s: some sign that it heard
export const MAX_DELAY = 2 // s: the answer itself has begun
export const DEFAULT_ACK: Track[] = [{ ch: 'eyes.boost', to: 0.35, attack: 0.05, hold: 0.08, release: 0.2 }]

/**
 * The channels every host can expect. A host maps the ones it has and ignores the rest.
 * 'name:*' stands for a family (crumble:shoulderL, ...). A personality may add more.
 */
export const CHANNELS: Record<string, ChannelKind> = {
  'head.pitch': 'offset', // rad, positive lowers the head
  'head.follow': 'gain', // how quickly the head follows
  'head.restless': 'gain', // how far the idle drift goes
  'eyes.gain': 'gain',
  'eyes.boost': 'offset', // light added to the eyes
  'eyes.flicker': 'offset', // 0..1
  'breath.rate': 'gain',
  'breath.depth': 'gain',
  'body.rise': 'offset', // 0..1, a full deep breath lifting the whole body
  glow: 'gain',
  'arteries.heat': 'offset', // 0..1
  'arteries.beat': 'gain',
  'crumble:*': 'offset', // 0..1 of a region gone to dust
  'rebuild:*': 'offset', // 0..1 progress of a piece lifting, turning, re-seating
}

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Objects merge key by key; arrays and plain values replace. */
export function merge<T>(base: T, patch: unknown): T {
  if (!isObj(base) || !isObj(patch)) return clone(patch) as T
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) out[k] = k in out && isObj(out[k]) && isObj(v) ? merge(out[k], v) : clone(v)
  return out as T
}

/** Only what changed from `base` to `now`, in the shape merge() takes back. */
export function diff(base: unknown, now: unknown): unknown {
  if (isObj(base) && isObj(now)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(now)) {
      const d = diff(base[k], v)
      if (d !== undefined) out[k] = d
    }
    return Object.keys(out).length ? out : undefined
  }
  return JSON.stringify(base) === JSON.stringify(now) ? undefined : clone(now)
}
