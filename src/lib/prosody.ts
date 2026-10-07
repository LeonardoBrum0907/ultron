/**
 * How something was said: loudness, pitch, how much the pitch moved, pauses and
 * speaking rate, measured from the microphone while the user talks.
 *
 * Laya v1 reads text only, so none of this reaches it. It is logged next to each
 * perception (logs/perception.jsonl, by the bridge) so that real utterances pile
 * up with their delivery; if the frozen test shows sarcasm or shouting lost in
 * the transcript, those logs become the data for a schema with voice fields.
 * Same measures as laya-setup's client/src/prosody.ts, taken frame by frame from
 * the analyser instead of from a recorded buffer.
 */
import { voiceFrame } from './audio'

export type Prosody = {
  durationMs: number
  /** Mean loudness of voiced frames, dBFS. */
  rmsDb: number
  peakDb: number
  /** Median pitch, Hz; null when nothing clearly voiced was heard. */
  pitchHz: number | null
  /** Pitch spread, interquartile range in semitones: low is flat, high is lively. */
  pitchRangeSt: number | null
  voicedRatio: number
  longestPauseMs: number
  wordsPerSec: number | null
}

type Frame = { t: number; db: number; f0: number | null }

const STEP_MS = 50
const KEEP_MS = 30_000
const SILENCE_DB = -50
const MIN_HZ = 75
const MAX_HZ = 400
/** Pitch is searched on a decimated copy: a quarter of the work, still plenty for a voice. */
const DECIMATE = 4

let frames: Frame[] = []
let from = 0
let timer = 0
const scratch = new Float32Array(2048 / DECIMATE)

function pitch(samples: Float32Array, sampleRate: number): number | null {
  const n = Math.floor(samples.length / DECIMATE)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let k = 0; k < DECIMATE; k++) s += samples[i * DECIMATE + k]
    scratch[i] = s / DECIMATE
  }
  const rate = sampleRate / DECIMATE
  const minLag = Math.floor(rate / MAX_HZ)
  const maxLag = Math.min(Math.ceil(rate / MIN_HZ), n - 1)
  let best = 0
  let bestLag = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0
    let e1 = 0
    let e2 = 0
    for (let i = 0; i + lag < n; i++) {
      num += scratch[i] * scratch[i + lag]
      e1 += scratch[i] * scratch[i]
      e2 += scratch[i + lag] * scratch[i + lag]
    }
    const r = num / (Math.sqrt(e1 * e2) || 1)
    if (r > best) {
      best = r
      bestLag = lag
    }
  }
  return best > 0.6 && bestLag > 0 ? rate / bestLag : null
}

function sample() {
  const frame = voiceFrame()
  if (!frame) return
  const { samples, sampleRate } = frame
  let sum = 0
  for (const v of samples) sum += v * v
  const db = 10 * Math.log10(sum / samples.length + 1e-12)
  const t = performance.now()
  frames.push({ t, db, f0: db >= SILENCE_DB ? pitch(samples, sampleRate) : null })
  if (frames[0].t < t - KEEP_MS) frames = frames.filter((f) => f.t >= t - KEEP_MS)
}

/** Start sampling the microphone. Idempotent; returns a function that stops it. */
export function startProsody(): () => void {
  if (!timer) timer = window.setInterval(sample, STEP_MS)
  return () => {
    clearInterval(timer)
    timer = 0
  }
}

/** The next utterance starts now (the user started talking, or the last one ended). */
export function markSpeechStart(): void {
  from = performance.now()
}

const quantile = (sorted: number[], q: number) => {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/**
 * The delivery of the utterance that just ended, from the frames since the last
 * markSpeechStart(), silent edges trimmed. Null when nothing was heard (typed
 * input, the analyser not up).
 */
export function measureUtterance(transcript: string): Prosody | null {
  const window_ = frames.filter((f) => f.t >= from)
  from = performance.now()
  let a = 0
  let b = window_.length - 1
  while (a <= b && window_[a].db < SILENCE_DB) a++
  while (b >= a && window_[b].db < SILENCE_DB) b--
  const spoken = window_.slice(a, b + 1)
  if (spoken.length < 3) return null

  const voiced = spoken.filter((f) => f.db >= SILENCE_DB)
  let pause = 0
  let longest = 0
  for (const f of spoken) {
    pause = f.db < SILENCE_DB ? pause + 1 : 0
    longest = Math.max(longest, pause)
  }
  const pitches = voiced.flatMap((f) => (f.f0 === null ? [] : [f.f0])).sort((x, y) => x - y)
  const words = transcript.trim() ? transcript.trim().split(/\s+/).length : 0
  const voicedSec = (voiced.length * STEP_MS) / 1000
  const round = (x: number, d = 1) => Number(x.toFixed(d))
  return {
    durationMs: Math.round(spoken[spoken.length - 1].t - spoken[0].t + STEP_MS),
    rmsDb: round(voiced.reduce((s, f) => s + f.db, 0) / voiced.length),
    peakDb: round(Math.max(...voiced.map((f) => f.db))),
    pitchHz: pitches.length >= 3 ? round(quantile(pitches, 0.5)) : null,
    pitchRangeSt:
      pitches.length >= 3 ? round(12 * Math.log2(quantile(pitches, 0.75) / quantile(pitches, 0.25)), 2) : null,
    voicedRatio: round(voiced.length / spoken.length, 2),
    longestPauseMs: longest * STEP_MS,
    wordsPerSec: words && voicedSec > 0 ? round(words / voicedSec, 2) : null,
  }
}
