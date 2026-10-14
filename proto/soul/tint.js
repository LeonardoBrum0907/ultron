// The soul's colour, and how it changes: not all at once, but like a fire whose
// temperature changes. The new colour is born at one point, the bottom of the ember (where
// Léo marked it), and spreads from there: up the heart and the flames faster than down or
// sideways, along a ragged front, to the smoke and then out through the dust, each particle
// turning on its own; a brighter band runs along where it is turning (shaders.js).
//
// It can be one palette or a mix of them, when the moods it shows are mixed (moods.js): each
// palette then burns in tongues of its own, about as much of the fire as its share, and where
// tongues meet their colours mix. The CPU keeps the mix it was and the one it is becoming, as
// how much of each palette they are (uMixWas, uMix), and how long ago it began (uShift).

import { SOUL_PALETTE_NAMES, SOUL_PALETTES } from './palettes.js'

/** How the change spreads (the shader is built from these, so they agree). */
export const TINT = {
  from: [0, -0.75], // world xy where the change is born: the bottom of the ember
  pace: 0.3, // s it takes to spread one world unit (up runs faster, down and sideways slower)
  reach: 9, // world units: past this, the dust turns all about together
  rough: 0.5, // s: how far a ragged front runs ahead or behind, away from where it is born
  spread: 0.6, // s: how far apart neighbours start to turn, away from where it is born
  turn: 1.0, // s each particle takes to turn
  hurry: 3, // a change picked while another runs speeds that one up this much
}
/** s after it begins when every particle has turned. */
TINT.settle = TINT.pace * TINT.reach + TINT.rough + TINT.spread + TINT.turn

/** How a mix of palettes shows in the fire (the shader is built from these). */
export const MIX = {
  // How far a palette's tongue lifts it over the others: at 3 each palette covers about its
  // share of the fire (measured over the shader's noise: 70/30 shows as 69/31).
  tongues: 3,
  edge: 0.6, // how softly tongues of different colours mix where they meet
  heartEdge: 0.25, // .. and at the heart, which has no tongues: the strongest leads there
  heart: [0.6, 2.4], // world units from the heart where the tongues begin, and are full
}

/** @typedef {string | Record<string, number>} SoulMix a palette's name, or how much of each (any scale) */

/**
 * @typedef {object} Tint
 * @property {(mix: SoulMix) => void} pick turn to this palette, or mix of them (keys of SOUL_PALETTES)
 * @property {(dt: number, uniforms: object) => void} tick moves the change on and sets its uniforms
 * @property {() => Record<string, number>} target the mix it is turning to, or has: each palette in it, its share
 */

/**
 * @param {SoulMix} start the palette or mix it starts in, already settled
 * @returns {Tint}
 * @example const tint = createTint('blue'); tint.pick({ red: 0.6, purple: 0.4 }); tint.tick(0.016, uniforms)
 */
export function createTint(start) {
  const first = weightsOf(start)
  const s = { was: first, to: first, since: TINT.settle, next: null }
  return {
    pick(mix) {
      const next = weightsOf(mix)
      s.next = distance(next, s.to) === 0 ? null : next
      if (s.since >= TINT.settle) begin(s)
    },
    tick(dt, uniforms) {
      s.since = Math.min(TINT.settle, s.since + dt * (s.next ? TINT.hurry : 1))
      if (s.since >= TINT.settle) begin(s)
      setColours(uniforms, s)
    },
    target: () => sharesOf(s.next ?? s.to),
  }
}

/**
 * How far apart two mixes are: 0 the same, 2 no palette in common.
 * @param {SoulMix} a
 * @param {SoulMix} b
 * @returns {number}
 * @example mixDistance('red', { red: 0.8, purple: 0.2 }) // 0.4
 */
export function mixDistance(a, b) {
  return distance(weightsOf(a), weightsOf(b))
}

// The change waiting (if any) begins from the colour it has now.
function begin(s) {
  if (!s.next) return
  Object.assign(s, { was: s.to, to: s.next, since: 0, next: null })
}

function setColours(uniforms, s) {
  s.was.forEach((w, i) => (uniforms.uMixWas.value[i] = w))
  s.to.forEach((w, i) => (uniforms.uMix.value[i] = w))
  uniforms.uShift.value = s.since
}

// How much of each palette, in SOUL_PALETTE_NAMES order, summing to 1.
function weightsOf(mix) {
  if (typeof mix === 'string') return (paletteOf(mix), SOUL_PALETTE_NAMES.map((name) => (name === mix ? 1 : 0)))
  for (const name of Object.keys(mix)) paletteOf(name)
  const weights = SOUL_PALETTE_NAMES.map((name) => Math.max(0, mix[name] ?? 0))
  const total = weights.reduce((sum, w) => sum + w, 0)
  if (!(total > 0)) {
    throw new Error(`soul mix ${JSON.stringify(mix)} is empty, expected a weight above 0 for one of ${SOUL_PALETTE_NAMES.join(', ')}`)
  }
  return weights.map((w) => w / total)
}

const distance = (a, b) => a.reduce((sum, w, i) => sum + Math.abs(w - b[i]), 0)

// The palettes in the mix, each with its share.
function sharesOf(weights) {
  return Object.fromEntries(SOUL_PALETTE_NAMES.map((name, i) => [name, weights[i]]).filter(([, w]) => w > 0))
}

function paletteOf(name) {
  const palette = SOUL_PALETTES[name]
  if (!palette) throw new Error(`unknown soul palette "${name}", expected one of ${SOUL_PALETTE_NAMES.join(', ')}`)
  return palette
}
