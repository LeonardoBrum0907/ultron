/**
 * Sound design.
 *
 * Every cue is synthesised in Web Audio rather than shipped as a file, so the
 * app makes the right noises the moment you clone it — nothing to download, no
 * licence to worry about, a few hundred bytes instead of a few megabytes.
 *
 * To use real recordings instead, drop matching files into `public/audio/`
 * (boot.mp3, wake.mp3, listen.mp3, tool.mp3, done.mp3, error.mp3) and they take
 * over automatically. Pixabay's sci-fi UI and HUD packs are the usual source —
 * CC0, no attribution, safe on a monetised channel. There is no music and no
 * ambient bed: the cues are the only sound the interface makes besides his voice.
 */

type Cue = 'boot' | 'wake' | 'listen' | 'tool' | 'done' | 'error'

let ctx: AudioContext | null = null
let master: GainNode | null = null
const samples = new Map<Cue, AudioBuffer>()

/** Where the master sits when ULTRON isn't speaking. */
let volume = 0.5
let ducked = false
/** How far everything this module makes drops under the voice. */
const DUCK = 0.45

function audio(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = volume
    master.connect(ctx.destination)
  }
  return ctx
}

/**
 * Ramp a gain to a new value from wherever it actually is.
 *
 * The cancel-then-anchor dance is not optional: a Web Audio ramp interpolates
 * from the *previous scheduled event*, so a later automation point that hasn't
 * fired yet — the three-second fade-in of the bed, say — survives, and the
 * value climbs back to it the moment the new ramp lands. That is how ducking
 * during the first seconds of the bed used to undo itself.
 */
function rampTo(param: AudioParam, to: number, seconds: number) {
  if (!ctx) return
  const now = ctx.currentTime
  param.cancelScheduledValues(now)
  param.setValueAtTime(param.value, now)
  param.linearRampToValueAtTime(Math.max(0.0001, to), now + seconds)
}

/**
 * Browsers won't start audio until the user has interacted with the page, so
 * this has to be called from a click or keypress.
 */
export async function unlockAudio(): Promise<void> {
  const c = audio()
  if (c.state === 'suspended') {
    try {
      await c.resume()
    } catch {
      /**
       * Swallowed on purpose: resume() rejects when there has been no user
       * gesture, and letting that reject would abort the whole power-up over a
       * sound that may well play fine anyway (any earlier interaction with the
       * page unlocks it). Boot either way: the worst case is a silent start,
       * not a dead one.
       */
    }
  }
  void loadOverrides()
}

/** Pick up any real audio files the user has dropped into public/audio/. */
async function loadOverrides() {
  const cues: Cue[] = ['boot', 'wake', 'listen', 'tool', 'done', 'error']
  await Promise.all(
    cues.map(async (cue) => {
      if (samples.has(cue)) return
      try {
        const res = await fetch(`/audio/${cue}.mp3`)
        if (!res.ok) return
        const buf = await audio().decodeAudioData(await res.arrayBuffer())
        samples.set(cue, buf)
      } catch {
        /* no override — the synthesised cue is used */
      }
    }),
  )
}

/**
 * The context and the output the cues play into, once audio is unlocked. Other
 * sounds of the interface (the dust, see dust.ts) hang off the same master so
 * the ducking under his voice covers them too. null until the first gesture.
 */
export function bus(): { ctx: AudioContext; out: GainNode } | null {
  return ctx && master && ctx.state === 'running' ? { ctx, out: master } : null
}

export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v))
  if (master) rampTo(master.gain, ducked ? volume * DUCK : volume, 0.05)
}

// ---------------------------------------------------------------------------
// Synthesis helpers
// ---------------------------------------------------------------------------

/** A pitched blip with an exponential decay — the basic HUD tick. */
function blip(
  freq: number,
  {
    at = 0,
    dur = 0.12,
    type = 'sine' as OscillatorType,
    gain = 0.25,
    sweepTo = 0,
  } = {},
) {
  const c = audio()
  const t = c.currentTime + at
  const osc = c.createOscillator()
  const env = c.createGain()

  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t + dur)

  // Fast attack, exponential tail — reads as electronic rather than musical.
  env.gain.setValueAtTime(0.0001, t)
  env.gain.exponentialRampToValueAtTime(gain, t + 0.008)
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur)

  osc.connect(env).connect(master!)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

/** Filtered noise burst — air, whooshes, transients. */
function noise({ at = 0, dur = 0.4, gain = 0.12, from = 400, to = 6000 } = {}) {
  const c = audio()
  const t = c.currentTime + at
  const frames = Math.floor(c.sampleRate * dur)
  const buf = c.createBuffer(1, frames, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1

  const src = c.createBufferSource()
  src.buffer = buf

  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = 1.2
  filter.frequency.setValueAtTime(from, t)
  filter.frequency.exponentialRampToValueAtTime(to, t + dur)

  const env = c.createGain()
  env.gain.setValueAtTime(0.0001, t)
  env.gain.exponentialRampToValueAtTime(gain, t + dur * 0.25)
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur)

  src.connect(filter).connect(env).connect(master!)
  src.start(t)
}

// ---------------------------------------------------------------------------

const synth: Record<Cue, () => void> = {
  /** Reactor spin-up: a rising sweep under stacked fifths. */
  boot: () => {
    noise({ dur: 2.2, gain: 0.1, from: 120, to: 5200 })
    blip(110, { dur: 2.4, type: 'sawtooth', gain: 0.1, sweepTo: 880 })
    blip(220, { at: 0.1, dur: 2.2, type: 'sine', gain: 0.09, sweepTo: 1320 })
    // The "online" confirmation — a clean rising third.
    blip(880, { at: 1.9, dur: 0.3, gain: 0.18 })
    blip(1320, { at: 2.05, dur: 0.45, gain: 0.2 })
  },

  /** Wake: two quick ascending pips. Deliberately short. */
  wake: () => {
    blip(1046, { dur: 0.09, gain: 0.22 })
    blip(1568, { at: 0.07, dur: 0.14, gain: 0.2 })
  },

  /** Listening: a single soft low pip so it doesn't fight the user's voice. */
  listen: () => blip(660, { dur: 0.1, gain: 0.14 }),

  /** A tool fired — a tiny mechanical tick. */
  tool: () => {
    blip(2200, { dur: 0.05, type: 'square', gain: 0.07 })
    noise({ dur: 0.1, gain: 0.05, from: 3000, to: 900 })
  },

  /** Turn complete: a descending pair, the inverse of wake. */
  done: () => {
    blip(1320, { dur: 0.1, gain: 0.14 })
    blip(880, { at: 0.08, dur: 0.2, gain: 0.13 })
  },

  /** Something failed — flat, slightly dissonant, not alarming. */
  error: () => {
    blip(320, { dur: 0.18, type: 'square', gain: 0.14 })
    blip(226, { at: 0.13, dur: 0.3, type: 'square', gain: 0.12 })
  },
}

export function play(cue: Cue) {
  if (!ctx || ctx.state !== 'running') return

  const sample = samples.get(cue)
  if (sample) {
    const src = ctx.createBufferSource()
    src.buffer = sample
    src.connect(master!)
    src.start()
    return
  }
  synth[cue]()
}

/**
 * Duck everything this module makes while ULTRON speaks, so a tool tick or a
 * completion chime never lands on top of a word. The cues all hang off the
 * master, so that is where it ducks.
 */
export function duck(on: boolean) {
  if (ducked === on || !master) return
  ducked = on
  // Out of the way quickly, back slowly — a fast recovery is audible as a
  // swell, and there is usually another sentence right behind the first.
  rampTo(master.gain, on ? volume * DUCK : volume, on ? 0.12 : 0.5)
}
