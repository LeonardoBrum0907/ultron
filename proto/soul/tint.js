// The soul's colour, and how it changes: not all at once, but like a fire whose
// temperature changes. The new colour starts in the heart and climbs through the flames
// to the smoke, then spreads out through the dust, each particle turning on its own; a
// brighter band runs along where it is turning (shaders.js). The CPU keeps the palette it
// was and the one it is becoming, and how long ago it began (uShift).

import { SOUL_PALETTES } from './palettes.js'

/** How the change spreads (the shader is built from these, so they agree). */
export const TINT = {
  pace: 0.3, // s it takes to climb one world unit away from the heart
  reach: 9, // world units: past this, the dust turns all about together
  spread: 0.6, // s: how far apart neighbours start to turn
  turn: 1.0, // s each particle takes to turn
  hurry: 3, // a change picked while another runs speeds that one up this much
}
/** s after it begins when every particle has turned. */
TINT.settle = TINT.pace * TINT.reach + TINT.spread + TINT.turn

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
  const [was, to] = [paletteOf(s.was), paletteOf(s.to)]
  uniforms.uHotWas.value.setRGB(...was.hot)
  uniforms.uMidWas.value.setRGB(...was.mid)
  uniforms.uCoolWas.value.setRGB(...was.cool)
  uniforms.uHot.value.setRGB(...to.hot)
  uniforms.uMid.value.setRGB(...to.mid)
  uniforms.uCool.value.setRGB(...to.cool)
  uniforms.uShift.value = s.since
}

function paletteOf(name) {
  const palette = SOUL_PALETTES[name]
  if (!palette) throw new Error(`unknown soul palette "${name}", expected one of ${Object.keys(SOUL_PALETTES).join(', ')}`)
  return palette
}
