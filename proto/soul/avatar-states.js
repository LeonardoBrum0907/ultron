// The avatar's states: what a project tells the soul it is doing, and how the fire shows
// it. Each state picks a colour (palettes.js), how high and bright the fire burns
// (energy, 0..1, the same lift the microphone gives it) and how fast it moves (pace, 1 is
// the soul page's own). A project can bring its own states with the same shape.

import { SOUL_PALETTES } from './palettes.js'

/** @typedef {{ palette: string, energy: number, pace: number }} AvatarState */

/** @type {Record<string, AvatarState>} */
export const AVATAR_STATES = {
  calm: { palette: 'blue', energy: 0, pace: 1 },
  thinking: { palette: 'purple', energy: 0.2, pace: 1.5 },
  angry: { palette: 'red', energy: 0.65, pace: 1.9 },
  happy: { palette: 'white', energy: 0.35, pace: 1.2 },
}

const EASE = 1.5 // 1/s: how quickly the fire's energy and pace follow a new state

/**
 * A state by name, checked.
 * @param {string} name
 * @param {Record<string, AvatarState>} [states]
 * @returns {AvatarState}
 * @example stateOf('calm').palette // 'blue'
 */
export function stateOf(name, states = AVATAR_STATES) {
  const state = states[name]
  if (!state) throw new Error(`unknown avatar state "${name}", expected one of ${Object.keys(states).join(', ')}`)
  if (!SOUL_PALETTES[state.palette]) {
    throw new Error(`avatar state "${name}" has palette "${state.palette}", expected one of ${Object.keys(SOUL_PALETTES).join(', ')}`)
  }
  return state
}

/**
 * The fire's energy and pace, easing towards the state's, so a change is never a jump.
 * @param {AvatarState} start
 * @returns {{ aim: (state: AvatarState) => void, tick: (dt: number) => { energy: number, pace: number } }}
 * @example const mood = easeAvatarState(stateOf('calm')); mood.aim(stateOf('angry')); mood.tick(0.016)
 */
export function easeAvatarState(start) {
  const now = { energy: start.energy, pace: start.pace }
  let target = start
  return {
    aim: (state) => void (target = state),
    tick(dt) {
      const k = 1 - Math.exp(-dt * EASE)
      now.energy += (target.energy - now.energy) * k
      now.pace += (target.pace - now.pace) * k
      return { ...now }
    },
  }
}
