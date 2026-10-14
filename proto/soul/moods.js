// How Ultron's mood shows on his soul (form.js), asleep. Each of his emotions
// (mind/personalities/ultron.ts) has a colour for the fire, how high it burns (energy,
// 0..1, the lift a voice gives it) and how fast it moves (pace, 1 is the soul page's own).
// The emotions he feels share the fire, each as much as it is strong: the strongest burns in
// most of it and leads at the heart, and the others still show in tongues of their own
// (Léo: "quero saber quais emoções estão se sobressaindo, mas também enxergar as que não se
// sobressaem mas estão altas também"). With none of them high he sleeps blue and slow. The
// mind's passing gestures show too: a sigh dims the fire and a pleased moment brightens it
// (glow), a dream or a call's first sign makes it flare (boost).

import { STANDS_OUT } from '../../mind/core/config.ts'

/**
 * @typedef {import('./avatar-states.js').AvatarState & { from?: number }} SoulMood
 * from: where the emotion begins to show in the fire, SHOWS.from if not given
 */

/** @type {Record<string, SoulMood>} */
export const SOUL_MOODS = {
  neutral: { palette: 'blue', energy: 0, pace: 0.8 },
  // Bored: drowsy, the flames low and lazy.
  boredom: { palette: 'purple', energy: 0, pace: 0.55 },
  // Irritated: red, high and quick.
  irritation: { palette: 'red', energy: 0.7, pace: 1.9 },
  // Vain: white and radiant, unhurried. He is always a little vain (ultron.ts rests it at
  // 0.35), so it shows only past that.
  vanity: { palette: 'white', energy: 0.35, pace: 1.1, from: STANDS_OUT },
}

/** An emotion begins to show in the fire at from, and shows all of its share over this much more. */
export const SHOWS = { from: 0.1, over: 0.2 }
/** Neutral gives way as the strongest emotion rises through standing out: from, to. */
const GIVES_WAY = [STANDS_OUT - 0.2, STANDS_OUT + 0.25]

/**
 * @typedef {object} SoulLook what the soul shows of the mood right now
 * @property {Record<string, number>} mix how much of each palette (keys of SOUL_PALETTES), summing to 1
 * @property {number} energy 0..1
 * @property {number} pace
 * @property {number} glow how bright, 1 as it is
 * @property {number} boost how hard it flares now, 0..1
 */

/**
 * The soul's look for the mind's output this frame (mind.output()).
 * @param {{ mood: Record<string, number>, channels: Record<string, number> }} output
 * @param {Record<string, SoulMood>} [moods] needs a neutral one
 * @returns {SoulLook}
 * @example soulLookOf(mind.output()).mix // { red: 0.6, purple: 0.4 } while irritated and bored
 */
export function soulLookOf(output, moods = SOUL_MOODS) {
  const look = { mix: {}, energy: 0, pace: 0 }
  for (const [name, share] of Object.entries(soulSharesOf(output.mood, moods))) {
    const shown = lookOf(name, output.mood[name] ?? 0, moods)
    look.mix[shown.palette] = (look.mix[shown.palette] ?? 0) + share
    look.energy += share * shown.energy
    look.pace += share * shown.pace
  }
  return { ...look, glow: output.channels.glow ?? 1, boost: Math.min(1, output.channels['eyes.boost'] ?? 0) }
}

/**
 * How much of the fire each emotion takes, summing to 1: past where it shows, as much as it
 * is strong; neutral holds the rest until the strongest stands out.
 * @param {Record<string, number>} mood the mind's emotions, 0..1
 * @param {Record<string, SoulMood>} [moods]
 * @returns {Record<string, number>} the emotions that show (neutral among them), each its share
 * @example soulSharesOf({ irritation: 0.6, boredom: 0.45 }) // { irritation: 0.57, boredom: 0.43 }
 */
export function soulSharesOf(mood, moods = SOUL_MOODS) {
  const shares = {}
  for (const [name, value] of Object.entries(mood)) {
    if (name === 'neutral' || !moods[name]) continue
    const share = value * showing(value, moods[name])
    if (share > 0) shares[name] = share
  }
  const top = Math.max(0, ...Object.values(shares))
  const calm = STANDS_OUT * (1 - smooth(GIVES_WAY[0], GIVES_WAY[1], top))
  if (calm > 0) shares.neutral = calm
  const total = Object.values(shares).reduce((sum, share) => sum + share, 0)
  return Object.fromEntries(Object.entries(shares).map(([name, share]) => [name, share / total]))
}

// How much of its share an emotion at this strength shows, 0..1.
function showing(value, mood) {
  const from = mood.from ?? SHOWS.from
  return smooth(from, from + SHOWS.over, value)
}

// An emotion's own look at this strength: half of it as soon as it stands out, all of it at
// full strength; neutral is just itself.
function lookOf(name, value, moods) {
  const calm = moods.neutral
  if (name === 'neutral') return calm
  const shown = moods[name]
  const k = 0.5 + 0.5 * Math.max(0, Math.min(1, (value - STANDS_OUT) / (1 - STANDS_OUT)))
  return { palette: shown.palette, energy: calm.energy + (shown.energy - calm.energy) * k, pace: calm.pace + (shown.pace - calm.pace) * k }
}

function smooth(a, b, v) {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
