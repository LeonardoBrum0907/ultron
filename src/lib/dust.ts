/**
 * The sound of the dust: a cosmic pad.
 *
 * Synthesised like the cues in sfx.ts, no files, and tonal on purpose: noise
 * read as wind on a microphone. The figure cannot say where its particles are
 * (they move on the GPU), but it knows how much they are moving and hands that
 * over every frame (see MOTION in proto/figure.js). That drives:
 *
 *   drone    a low chord (A1, E2, A2, each a pair slightly detuned so it beats
 *            slowly) that swells with the motion: the currents assembling him
 *            at boot, the cursor through the dust, a part coming apart or back
 *   halo     the chord's upper partials, drifting a little in pitch, brought in
 *            by the assembly and the cursor
 *   bloom    a sub-bass "vuum" falling away under each stressed syllable
 *   glide    a slow sine sigh downward as a part crumbles, upward as it is
 *            rebuilt
 *
 * All of it through a long generated reverb. At rest it is silent. It plays
 * into the cues' master, so it ducks under his voice with them, and has its own
 * level on top (the L panel's slider).
 */
import { bus } from './sfx'
import type { Motion } from '../../proto/figure.js'

const LEVEL_KEY = 'ultron.dust'

let level = (() => {
  try {
    const raw = localStorage.getItem(LEVEL_KEY)
    const v = Number(raw)
    return raw == null || !Number.isFinite(v) ? 0.6 : v
  } catch {
    return 0.6
  }
})()

const DRONE: [number, number][] = [
  [55, 0.5],
  [55.4, 0.4],
  [82.4, 0.35],
  [110, 0.25],
  [110.7, 0.2],
]
const HALO: [number, number][] = [
  [220, 0.12],
  [329.6, 0.09],
  [440, 0.06],
  [659.3, 0.04],
]

type Graph = {
  ctx: AudioContext
  out: GainNode
  /** Where every voice goes: dry to the output, and through the reverb. */
  send: GainNode
  drone: GainNode
  halo: GainNode
}

let graph: Graph | null = null
let crumbleWas = 0
let rebuildWas = 0
let glidedAt = 0

/** A long dark tail: decaying noise, smoothed, as an impulse response. */
function hall(ctx: AudioContext, secs = 4.5): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * secs)
  const ir = ctx.createBuffer(2, n, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch)
    let s = 0
    for (let i = 0; i < n; i++) {
      s = 0.6 * s + 0.4 * (Math.random() * 2 - 1)
      d[i] = s * Math.exp((-i / ctx.sampleRate) * (6.9 / secs))
    }
  }
  return ir
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
  const send = ctx.createGain()
  const dry = ctx.createGain()
  dry.gain.value = 0.55
  const verb = ctx.createConvolver()
  verb.buffer = hall(ctx)
  const wet = ctx.createGain()
  wet.gain.value = 0.6
  send.connect(dry).connect(out)
  send.connect(verb).connect(wet).connect(out)

  const drone = ctx.createGain()
  drone.gain.value = 0
  drone.connect(send)
  for (const [f, a] of DRONE) {
    const o = ctx.createOscillator()
    o.frequency.value = f
    const g = ctx.createGain()
    g.gain.value = a * 0.3
    o.connect(g).connect(drone)
    o.start()
  }

  const halo = ctx.createGain()
  halo.gain.value = 0
  halo.connect(send)
  // One slow wobble shared by the partials, so they drift together.
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 0.13
  lfo.start()
  for (const [f, a] of HALO) {
    const o = ctx.createOscillator()
    o.frequency.value = f
    const depth = ctx.createGain()
    depth.gain.value = f * 0.003
    lfo.connect(depth).connect(o.frequency)
    const g = ctx.createGain()
    g.gain.value = a * 0.3
    o.connect(g).connect(halo)
    o.start()
  }

  graph = { ctx, out, send, drone, halo }
  return graph
}

/** Glide a parameter toward a value; tc is the time constant in seconds. */
function glide(p: AudioParam, to: number, tc: number) {
  if (!graph) return
  p.setTargetAtTime(to, graph.ctx.currentTime, tc)
}

/** A slow sine sigh from one pitch to another. */
function sigh(g: Graph, from: number, to: number, secs: number, amp: number) {
  const at = g.ctx.currentTime
  const o = g.ctx.createOscillator()
  o.frequency.setValueAtTime(from, at)
  o.frequency.exponentialRampToValueAtTime(to, at + secs)
  const env = g.ctx.createGain()
  env.gain.setValueAtTime(0.0001, at)
  env.gain.exponentialRampToValueAtTime(amp, at + secs * 0.3)
  env.gain.exponentialRampToValueAtTime(0.0001, at + secs * 1.2)
  o.connect(env).connect(g.send)
  o.start(at)
  o.stop(at + secs * 1.25)
}

/** Every frame, from the figure. */
export function onMotion(m: Motion) {
  const g = ensure()
  if (!g) return

  // Quick to come in, slow to let go, so a flick of the cursor still blooms and then rings out.
  const swell = Math.max(m.assembly, 0.9 * m.cursor, 0.5 * m.crumble, 0.5 * m.rebuild)
  const halo = Math.max(m.assembly, 0.9 * m.cursor)
  glide(g.drone.gain, swell, swell > g.drone.gain.value ? 0.12 : 0.6)
  glide(g.halo.gain, halo, halo > g.halo.gain.value ? 0.12 : 0.7)

  // A part starting to come apart sighs down; one starting to come back sighs up. Once per
  // gesture, not every frame it grows.
  const now = g.ctx.currentTime
  if (m.crumble > 0.05 && crumbleWas <= 0.05 && now - glidedAt > 0.5) {
    glidedAt = now
    sigh(g, 330, 82, 1.4, 0.12)
    sigh(g, 220, 55, 1.6, 0.1)
  }
  if (m.rebuild > 0.05 && rebuildWas <= 0.05 && now - glidedAt > 0.5) {
    glidedAt = now
    sigh(g, 82, 330, 1.4, 0.1)
    sigh(g, 55, 220, 1.6, 0.08)
  }
  crumbleWas = m.crumble
  rebuildWas = m.rebuild
}

/** A stressed syllable's wave out of the mouth: a sub-bass bloom under the word. */
export function onWave(strength: number) {
  const g = graph
  if (!g) return
  const at = g.ctx.currentTime
  const o = g.ctx.createOscillator()
  o.frequency.setValueAtTime(70, at)
  o.frequency.exponentialRampToValueAtTime(28, at + 1.2)
  const env = g.ctx.createGain()
  env.gain.setValueAtTime(0.0001, at)
  env.gain.exponentialRampToValueAtTime(0.35 * strength + 0.0001, at + 0.04)
  env.gain.exponentialRampToValueAtTime(0.0001, at + 1.0)
  o.connect(env).connect(g.send)
  o.start(at)
  o.stop(at + 1.05)
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
