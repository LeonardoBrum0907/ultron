// How Ultron's mood shows on his soul (form.js), asleep. Each of his emotions
// (mind/personalities/ultron.ts) picks a colour for the fire, how high it burns (energy,
// 0..1, the lift a voice gives it) and how fast it moves (pace, 1 is the soul page's own);
// the stronger the emotion, the more of that it shows. With none standing out he sleeps
// blue and slow. The mind's passing gestures show too: a sigh dims the fire and a pleased
// moment brightens it (glow), a dream or a call's first sign makes it flare (boost).

import { STANDS_OUT } from '../../mind/core/config.ts'

/** @typedef {import('./avatar-states.js').AvatarState} SoulMood */

/** @type {Record<string, SoulMood>} */
export const SOUL_MOODS = {
  neutral: { palette: 'blue', energy: 0, pace: 0.8 },
  // Bored: drowsy, the flames low and lazy.
  boredom: { palette: 'purple', energy: 0, pace: 0.55 },
  // Irritated: red, high and quick.
  irritation: { palette: 'red', energy: 0.7, pace: 1.9 },
  // Vain: white and radiant, unhurried.
  vanity: { palette: 'white', energy: 0.35, pace: 1.1 },
}

/**
 * @typedef {object} SoulLook what the soul shows of the mood right now
 * @property {string} palette a key of SOUL_PALETTES
 * @property {number} energy 0..1
 * @property {number} pace
 * @property {number} glow how bright, 1 as it is
 * @property {number} boost how hard it flares now, 0..1
 */

/**
 * The soul's look for the mind's output this frame (mind.output()).
 * @param {{ mood: Record<string, number>, dominant: string, channels: Record<string, number> }} output
 * @param {Record<string, SoulMood>} [moods] needs a neutral one
 * @returns {SoulLook}
 * @example soulLookOf(mind.output()).palette // 'red' while he is irritated
 */
export function soulLookOf(output, moods = SOUL_MOODS) {
  const name = moods[output.dominant] ? output.dominant : 'neutral'
  const shown = moods[name]
  const k = name === 'neutral' ? 1 : strengthOf(output.mood[name] ?? 0)
  const calm = moods.neutral
  return {
    palette: shown.palette,
    energy: calm.energy + (shown.energy - calm.energy) * k,
    pace: calm.pace + (shown.pace - calm.pace) * k,
    glow: output.channels.glow ?? 1,
    boost: Math.min(1, output.channels['eyes.boost'] ?? 0),
  }
}

// How far past standing out an emotion is: half its look as soon as it stands out (its
// colour is all there already), all of it at full strength.
function strengthOf(value) {
  const past = Math.max(0, Math.min(1, (value - STANDS_OUT) / (1 - STANDS_OUT)))
  return 0.5 + 0.5 * past
}
