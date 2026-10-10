/**
 * The sound of the dust.
 *
 * Synthesised like the cues in sfx.ts: no files, nothing to license. The figure
 * cannot say where its particles are (they move on the GPU), but it knows how
 * much they are moving, and hands that over every frame (see MOTION in
 * proto/figure.js). That drives four sounds:
 *
 *   breath   the currents assembling him at boot, or taking him apart: a band
 *            of noise that swells and opens while they fly
 *   hiss     the cursor cutting through the dust: thin, bright, only while it
 *            moves
 *   crackle  a part of him crumbling: short dry grains, as fast as it goes
 *   rush     a wave out of his mouth on a stressed syllable, and a part being
 *            rebuilt: a low muffled push
 *
 * At rest it is silent. It plays into the cues' master, so it ducks under his
 * voice with them, and has its own level on top (the L panel's slider).
 */
import { bus } from './sfx'
import type { Motion } from '../../proto/figure.js'

const LEVEL_KEY = 'ultron.dust'

let level = (() => {
  try {
    const v = Number(localStorage.getItem(LEVEL_KEY))
    return localStorage.getItem(LEVEL_KEY) == null || !Number.isFinite(v) ? 0.6 : v
  } catch {
    return 0.6
  }
})()

type Graph = {
  ctx: AudioContext
  out: GainNode
  noise: AudioBuffer
  breath: { gain: GainNode; band: BiquadFilterNode }
  hiss: GainNode
  rush: { gain: GainNode; low: BiquadFilterNode }
}

let graph: Graph | null = null
let last = 0
let crumbleWas = 0
let grainDebt = 0

/** Two seconds of pinkish noise, looped by every voice from its own offset. */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const n = ctx.sampleRate * 2
  const buf = ctx.createBuffer(1, n, ctx.sampleRate)
  const d = buf.getChannelData(0)
  // Paul Kellet's economy pink filter: softer than white, closer to sand.
  let b0 = 0, b1 = 0, b2 = 0
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1
    b0 = 0.99765 * b0 + w * 0.099046
    b1 = 0.963 * b1 + w * 0.2965164
    b2 = 0.57 * b2 + w * 1.0526913
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2
  }
  return buf
}

function loop(g: { ctx: AudioContext; noise: AudioBuffer }, into: AudioNode) {
  const src = g.ctx.createBufferSource()
  src.buffer = g.noise
  src.loop = true
  src.connect(into)
  src.start(0, Math.random() * 2)
}

/** Built on first use after audio is unlocked; silent (and cheap) until then. */
function ensure(): Graph | null {
  if (graph) return graph
  const b = bus()
  if (!b) return null
  const { ctx } = b
  const out = ctx.createGain()
  out.gain.value = level
  out.connect(b.out)
  const noise = noiseBuffer(ctx)

  const bg = ctx.createGain()
  bg.gain.value = 0
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 600
  band.Q.value = 0.8
  band.connect(bg).connect(out)

  const hiss = ctx.createGain()
  hiss.gain.value = 0
  const high = ctx.createBiquadFilter()
  high.type = 'highpass'
  high.frequency.value = 3800
  high.connect(hiss).connect(out)

  const rg = ctx.createGain()
  rg.gain.value = 0
  const low = ctx.createBiquadFilter()
  low.type = 'lowpass'
  low.frequency.value = 420
  low.connect(rg).connect(out)

  graph = { ctx, out, noise, breath: { gain: bg, band }, hiss, rush: { gain: rg, low } }
  loop(graph, band)
  loop(graph, high)
  loop(graph, low)
  return graph
}

/** Glide a parameter toward a value; tc is the time constant in seconds. */
function glide(p: AudioParam, to: number, tc: number) {
  if (!graph) return
  p.setTargetAtTime(to, graph.ctx.currentTime, tc)
}

/** One dry grain of a crumble: a few ms of bright noise. */
function grain(g: Graph, at: number, amp: number) {
  const src = g.ctx.createBufferSource()
  src.buffer = g.noise
  const env = g.ctx.createGain()
  const hp = g.ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 1800 + Math.random() * 3500
  env.gain.setValueAtTime(0, at)
  env.gain.linearRampToValueAtTime(amp, at + 0.002)
  env.gain.exponentialRampToValueAtTime(0.0001, at + 0.012 + Math.random() * 0.03)
  src.connect(hp).connect(env).connect(g.out)
  src.start(at, Math.random() * 1.9, 0.06)
}

/** Every frame, from the figure. */
export function onMotion(m: Motion) {
  const g = ensure()
  if (!g) return
  const now = performance.now() / 1000
  const dt = last ? Math.min(0.1, now - last) : 0
  last = now

  // breath: the assembly, and a part lifting off to be rebuilt (quieter)
  const breath = Math.max(m.assembly, 0.45 * m.rebuild)
  glide(g.breath.gain.gain, 0.5 * breath, 0.15)
  glide(g.breath.band.frequency, 450 + 1700 * breath, 0.25)

  // hiss: the cursor, only while it moves
  glide(g.hiss.gain, 0.22 * Math.pow(m.cursor, 1.5), 0.05)

  // rush: a part settling back as the rebuild lets go
  glide(g.rush.gain.gain, 0.35 * m.rebuild, 0.3)

  // crackle: as many grains as the crumble is moving, a few more while it builds, and a
  // sparse sparkle while the currents fly
  const growing = Math.max(0, m.crumble - crumbleWas) / Math.max(dt, 1e-3)
  crumbleWas = m.crumble
  const rate = 260 * Math.min(1, growing) + 30 * m.crumble + 18 * m.assembly
  grainDebt += rate * dt
  const t0 = g.ctx.currentTime
  for (let i = 0; grainDebt >= 1 && i < 12; i++, grainDebt--) {
    grain(g, t0 + Math.random() * dt, 0.05 + 0.12 * Math.random())
  }
  grainDebt = Math.min(grainDebt, 4)
}

/** A stressed syllable's wave out of the mouth: a low "fff" under the word. */
export function onWave(strength: number) {
  const g = graph
  if (!g) return
  const at = g.ctx.currentTime
  const src = g.ctx.createBufferSource()
  src.buffer = g.noise
  const lp = g.ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(900, at)
  lp.frequency.exponentialRampToValueAtTime(220, at + 0.6)
  const env = g.ctx.createGain()
  env.gain.setValueAtTime(0, at)
  env.gain.linearRampToValueAtTime(0.18 * strength, at + 0.03)
  env.gain.exponentialRampToValueAtTime(0.0001, at + 0.7)
  src.connect(lp).connect(env).connect(g.out)
  src.start(at, Math.random() * 1.2, 0.75)
}

export function dustLevel(): number {
  return level
}

export function setDustLevel(v: number) {
  level = Math.max(0, Math.min(1, v))
  if (graph) glide(graph.out.gain, level, 0.05)
  try {
    localStorage.setItem(LEVEL_KEY, String(level))
  } catch {
    // Private mode: it just will not be remembered.
  }
}
