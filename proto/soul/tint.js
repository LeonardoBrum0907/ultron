// The soul's colour, and how it changes: not all at once, but like a fire whose
// temperature changes. The new colour is born at one point, the bottom of the ember (where
// Léo marked it), and spreads from there: up the heart and the flames faster than down or
// sideways, along a ragged front, to the smoke and then out through the dust, each particle
// turning on its own; a brighter band runs along where it is turning (shaders.js). The CPU keeps the palette it
// was and the one it is becoming, as how much of each palette they are (uMixWas, uMix), and
// how long ago it began (uShift).

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

/**
 * @typedef {object} Tint
 * @property {(name: string) => void} pick turn to this palette (a key of SOUL_PALETTES)
 * @property {(dt: number, uniforms: object) => void} tick moves the change on and sets its uniforms
 * @property {() => string} target the palette it is turning to, or has
 */

/**
 * @param {string} start the palette it starts in, already settled
 * @returns {Tint}
 * @example const tint = createTint('blue'); tint.pick('red'); tint.tick(0.016, uniforms)
 */
export function createTint(start) {
  paletteOf(start)
  const s = { was: start, to: start, since: TINT.settle, next: null }
  return {
    pick(name) {
      paletteOf(name)
      s.next = name === s.to ? null : name
      if (s.since >= TINT.settle) begin(s)
    },
    tick(dt, uniforms) {
      s.since = Math.min(TINT.settle, s.since + dt * (s.next ? TINT.hurry : 1))
      if (s.since >= TINT.settle) begin(s)
      setColours(uniforms, s)
    },
    target: () => s.next ?? s.to,
  }
}

// The change waiting (if any) begins from the colour it has now.
function begin(s) {
  if (!s.next) return
  Object.assign(s, { was: s.to, to: s.next, since: 0, next: null })
}

function setColours(uniforms, s) {
  setWeights(uniforms.uMixWas.value, s.was)
  setWeights(uniforms.uMix.value, s.to)
  uniforms.uShift.value = s.since
}

// All of the palette named, none of the others.
function setWeights(into, name) {
  SOUL_PALETTE_NAMES.forEach((each, i) => (into[i] = each === name ? 1 : 0))
}

function paletteOf(name) {
  const palette = SOUL_PALETTES[name]
  if (!palette) throw new Error(`unknown soul palette "${name}", expected one of ${Object.keys(SOUL_PALETTES).join(', ')}`)
  return palette
}
