// The shapes a personality is written in, and what the mind hands back to its host.
// Everything here is plain data (JSON-serialisable), so a personality can be stored,
// diffed, patched live from the panel, or loaded from anywhere.

/** A number, or [min, max] to draw a fresh value from each time it is used. */
export type Range = number | [number, number]

/** How values on one channel combine: offsets add up from 0, gains multiply from 1. */
export type ChannelKind = 'offset' | 'gain'

export interface EmotionConfig {
  /** Where it settles when nothing pushes it, 0..1. */
  rest: number
  /** Volume of this emotion: what shows is (value + mood) * gain * temper.intensity. */
  gain: number
  /** Seconds for the value of the moment to get halfway back to rest. */
  halfLife: number
  /**
   * The background part (mood) that outlives a session and adds on top of the value. It
   * follows how far the value sits above rest, by `share` of the gap per minute, and
   * fades with its own halfLife (s). Without it the emotion has no background.
   */
  memory?: { share: number; halfLife: number }
}

/** Per-second push on emotions while a condition holds. */
export interface Drive {
  /** Holds while nothing counted as an interaction has happened for `idleAfter` s. */
  idle?: boolean
  /** Holds while this emotion's visible value is above `above`. */
  emotion?: string
  above?: number
  /** Only in these contexts (all, if left out). */
  contexts?: string[]
  add: Record<string, number>
}

/** +x adds to the emotion, '*x' multiplies its present value. */
export type Effect = number | `*${number}`

export interface StimulusConfig {
  /** Counts as the user doing something: resets the idle clock. */
  interaction?: boolean
  effects?: Record<string, Effect>
  /** A payload field that scales the additive effects (e.g. 'strength'). */
  scale?: string
  /** Ignored if it came less than this many seconds after the last one. */
  every?: number
  /** Extra effects when it comes again within `within` s of the last one. */
  again?: { within: number; effects: Record<string, Effect> }
}

export interface ContextConfig {
  /** 0..1: how free it is to act on its own. Reactions ask for a minimum. */
  freedom?: number
  /** 0..1: how much the emotions show in the continuous expressions. */
  expression?: number
  /** Nothing happens: no drives, no stimuli, no reactions; emotions only fade. */
  paused?: boolean
}

/** A continuous link from an emotion to a channel: amount * emotion^curve. */
export interface Expression {
  emotion: string
  ch: string
  amount: number
  curve?: number
}

/** Where to look. Coordinates are -1..1 across the host's view, y growing downward. */
export type GazeTarget =
  | 'focus' // the user, live
  | 'awayFromFocus' // the other side from the user (picked once, at the start)
  | 'lastFocus' // where the user was last seen
  | 'center'
  | { x: Range; y?: Range }
  | { sweep: [Range, Range]; y?: Range; pauseChance?: number; pause?: Range }

export interface Track {
  /** Channel name. 'gaze' takes `target` instead of `to`. A '*' is replaced by one of `pick`. */
  ch: string
  /** The value at the peak (an offset, or a gain factor). */
  to?: Range
  target?: GazeTarget
  /** For gaze: push lastFocus out to the edge of the view. */
  edge?: boolean
  /** For gaze: how much it overrides the host's own following, 0..1. */
  weight?: Range
  pick?: string[]
  at?: Range
  attack?: Range
  /** Seconds at the peak, or 'len' for the reaction's shared length. */
  hold?: Range | 'len'
  release?: Range
}

export interface ReactionConfig {
  /** reflex: answers a stimulus. spontaneous: drawn by the director. */
  kind: 'reflex' | 'spontaneous'
  /** reflex: the stimulus it answers ('rise:<emotion>:<level>' and 'fall:...' work too). */
  on?: string
  enabled?: boolean
  /** Base weight in the director's draw. */
  base?: number
  /** It only happens where the context's freedom is at least this. */
  minFreedom?: number
  when?: { focusStill?: number; focusPresent?: boolean }
  /** Visible emotion bounds, [min, max]. */
  requires?: Record<string, [number, number]>
  favoredBy?: Record<string, number>
  /** reflex: probability of reacting, plus chanceBy[e] * emotion. */
  chance?: number
  chanceBy?: Record<string, number>
  /** Seconds before it may happen again. */
  cooldown?: number
  /** A reflex of higher priority cuts the one playing. */
  priority?: number
  /** Flip left and right at random. */
  mirror?: boolean
  /** A length shared by tracks that say hold: 'len'. */
  len?: Range
  /** A warning before the main part: its tracks play first, the main part waits `for` s. */
  warn?: { for: Range; does: Track[] }
  does: Track[]
  /** The held part ends `then` s after this stimulus arrives (or at its own end). */
  until?: { stimulus: string; then?: Range; release?: Range }
  /** Effects on the emotions when it finishes. */
  after?: Record<string, Effect>
}

export interface Rhythm {
  /** Seconds at least between two spontaneous reactions. */
  minGap: number
  /** Mean of the random wait on top of minGap (exponential: irregular, like rain). */
  mean: number
  /** The wait never goes past this. */
  max: number
  /** Weight of doing nothing when the time comes. */
  rest: number
  /** Emotions that shorten the wait: mean / (1 + sum of hurry[e] * emotion). */
  hurry?: Record<string, number>
}

export interface Personality {
  name: string
  version: number
  temper: { intensity: number; frequency: number; volatility: number }
  emotions: Record<string, EmotionConfig>
  /** Seconds without an interaction before it counts as idle. */
  idleAfter: number
  drives: Drive[]
  stimuli: Record<string, StimulusConfig>
  contexts: Record<string, ContextConfig>
  rhythm: Rhythm
  expressions: Expression[]
  reactions: Record<string, ReactionConfig>
  /** Extra channels, or other kinds for known ones. */
  channels?: Record<string, ChannelKind>
  /**
   * every: seconds between saves. maxAway: how much of the time away counts as being
   * left idle (the rest only fades). awayContext: the context that idle time runs in.
   */
  persist: { every: number; maxAway: number; awayContext?: string }
}

export interface Saved {
  version: 1
  personality: string
  /** Wall clock, ms since the epoch. */
  savedAt: number
  emotions: Record<string, { value: number; mood: number }>
}

export interface Storage {
  load(): Saved | null | Promise<Saved | null>
  save(saved: Saved): void | Promise<void>
}

export interface Focus {
  x: number
  y: number
  present: boolean
}

export interface Output {
  /** Every channel with a value; read missing ones as neutral (mind.channel does). */
  channels: Record<string, number>
  gaze: { x: number; y: number; weight: number }
  /** Visible emotions, 0..1. */
  mood: Record<string, number>
  /** The strongest emotion above 0.35, or 'neutral'. */
  dominant: string
  /** The background part of each emotion, 0..1. */
  background: Record<string, number>
  active: string | null
  context: string
  /** Seconds until the director draws again. */
  nextIn: number
}

export type MindEvent =
  | { type: 'stimulus'; t: number; name: string; payload?: Record<string, unknown> }
  | { type: 'reaction'; t: number; name: string; phase: 'start' | 'end' | 'cut' }
  | { type: 'context'; t: number; name: string }
