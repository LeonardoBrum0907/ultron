// The soul's particles, made once: which part of it each one belongs to and its random
// numbers. Everything else (where it is, how bright) the vertex shader works out every
// frame from these and the clock, so nothing moves on the CPU.

/** The parts of the soul, in the order the shader numbers them (aMeta.x). */
export const PART = { core: 0, halo: 1, flame: 2, smoke: 3, ember: 4 }

/** How many particles each part gets. ~78k: the figure's ~95k runs fine on Léo's PC. */
export const SOUL_BUDGET = { core: 16000, halo: 1500, flame: 46000, smoke: 14000, ember: 350 }

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
 * @property {Float32Array} meta per particle: x its part (PART), y one more random number
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
  const swarm = { rand: new Float32Array(count * 4), meta: new Float32Array(count * 2), count }
  let i = 0
  for (const [part, n] of Object.entries(budget)) {
    if (!(part in PART)) throw new Error(`unknown soul part "${part}", expected one of ${Object.keys(PART).join(', ')}`)
    for (let k = 0; k < n; k++, i++) fillParticle(swarm, i, PART[part], rand)
  }
  return swarm
}

function fillParticle(swarm, i, part, rand) {
  for (let c = 0; c < 4; c++) swarm.rand[i * 4 + c] = rand()
  swarm.meta[i * 2] = part
  swarm.meta[i * 2 + 1] = rand()
}
