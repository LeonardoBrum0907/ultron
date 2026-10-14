// The soul's particles, made once: which part of it each one belongs to, which current
// carries it there from the dust and when, and its random numbers. Everything else (where
// it is, how bright) the vertex shader works out every frame from these and the clocks,
// so nothing moves on the CPU.

/** The parts of the soul, in the order the shader numbers them (aMeta.x). */
export const PART = { core: 0, halo: 1, flame: 2, smoke: 3, ember: 4, dust: 5 }

/** How many particles each part gets. ~84k: the figure's ~95k runs fine on Léo's PC. */
export const SOUL_BUDGET = { core: 16000, halo: 1500, flame: 46000, smoke: 14000, ember: 350, dust: 6000 }

/** How many currents carry the dust into the soul (the shader's arrays are this long). */
export const CURRENTS = 5

// When each part sets off after the summons (s, from at over spread) and how long it flies:
// the orb gathers first, then the fire it lights, then the smoke over the fire. The dust
// never leaves the cloud.
const FLIGHT = {
  core: { at: 0, spread: 1.4, dur: [2.0, 2.8] },
  halo: { at: 1.4, spread: 1.0, dur: [2.0, 2.6] },
  flame: { at: 2.0, spread: 2.4, dur: [2.0, 2.8] },
  smoke: { at: 4.0, spread: 1.6, dur: [2.2, 3.0] },
  ember: { at: 4.4, spread: 1.8, dur: [1.6, 2.2] },
}
const NEVER = 1e6

/** When the last particle has landed, s after the summons. */
export const ASSEMBLY_END = Math.max(...Object.values(FLIGHT).map((f) => f.at + f.spread + f.dur[1]))

/**
 * A small seeded random generator (mulberry32), so a seed always builds the same soul.
 * @param {number} seed any 32-bit integer
 * @returns {() => number} the next number in [0, 1)
 * @example const rand = seededRandom(7); rand() // 0.0..1
 */
export function seededRandom(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * @typedef {object} SoulSwarm
 * @property {Float32Array} rand four random numbers per particle, in [0, 1)
 * @property {Float32Array} meta per particle: its part (PART), one more random number, its current, its lane
 * @property {Float32Array} fly per particle: when it sets off, how long it flies, two random numbers for its rest
 * @property {number} count how many particles
 */

/**
 * Lays out the particles part by part.
 * @param {Record<keyof typeof PART, number>} budget particles per part
 * @param {() => number} rand where the random numbers come from
 * @returns {SoulSwarm}
 * @example const swarm = buildSwarm(SOUL_BUDGET, seededRandom(1))
 */
export function buildSwarm(budget, rand) {
  const count = Object.values(budget).reduce((n, k) => n + k, 0)
  const swarm = { rand: new Float32Array(count * 4), meta: new Float32Array(count * 4), fly: new Float32Array(count * 4), count }
  let i = 0
  for (const [part, n] of Object.entries(budget)) {
    if (!(part in PART)) throw new Error(`unknown soul part "${part}", expected one of ${Object.keys(PART).join(', ')}`)
    for (let k = 0; k < n; k++, i++) fillParticle(swarm, i, part, rand)
  }
  return swarm
}

function fillParticle(swarm, i, part, rand) {
  const r = [rand(), rand(), rand(), rand()]
  swarm.rand.set(r, i * 4)
  const [current, lane] = routeOf(part, r, rand)
  swarm.meta.set([PART[part], rand(), current, lane], i * 4)
  swarm.fly.set([...flightOf(part, rand), rand(), rand()], i * 4)
}

/**
 * Which current carries a particle and its lane across the stream (0..1, left to right
 * where it lands), so a stream does not tangle. The five currents carry about as many
 * each: the heart of the fire and its glow; the flames in three, left, middle and right (by where on
 * the orb they are born, r[1]); the smoke and the embers.
 * @param {string} part a key of PART
 * @param {number[]} r the particle's four random numbers
 * @param {() => number} rand
 * @returns {[number, number]} current, lane
 */
export function routeOf(part, r, rand) {
  if (part === 'core') return [0, r[1]] // across its layer, left to right
  if (part === 'halo') return [0, r[0]]
  if (part === 'flame') return [1 + Math.min(2, Math.floor(r[1] * 3)), (r[1] * 3) % 1]
  if (part === 'smoke' || part === 'ember') return [4, r[1]]
  return [Math.floor(rand() * CURRENTS), rand()] // the dust: anywhere in the cloud
}

function flightOf(part, rand) {
  const f = FLIGHT[part]
  if (!f) return [NEVER, 1]
  return [f.at + rand() * f.spread, f.dur[0] + rand() * (f.dur[1] - f.dur[0])]
}
