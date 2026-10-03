// A track's shape over time: it eases in (attack), stays (hold), eases out (release).

/** A track with every range drawn, in seconds since its reaction began. */
export interface Span {
  at: number
  attack: number
  hold: number
  release: number
}

export const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))

export const holdStart = (s: Span) => s.at + s.attack
export const holdEnd = (s: Span) => s.at + s.attack + s.hold
export const spanEnd = (s: Span) => s.at + s.attack + s.hold + s.release

/** 0..1 at `t` seconds since the reaction began. */
export function envelope(s: Span, t: number): number {
  if (t < s.at) return 0
  if (t < holdStart(s)) return s.attack > 0 ? smooth((t - s.at) / s.attack) : 1
  if (t < holdEnd(s)) return 1
  const r = t - holdEnd(s)
  if (r >= s.release) return 0
  return s.release > 0 ? 1 - smooth(r / s.release) : 0
}

/** How long a cut reaction takes to let go. */
export const CUT_RELEASE = 0.25

/** The envelope of a reaction that was cut at `cutAt` (both in seconds since it began). */
export function cutEnvelope(s: Span, t: number, cutAt: number): number {
  return envelope(s, Math.min(t, cutAt)) * (1 - smooth((t - cutAt) / CUT_RELEASE))
}
