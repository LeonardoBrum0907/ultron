// A seeded generator, so the same seed always plays the same life (tests depend on it).
import type { Range } from './types.ts'

export interface Rng {
  next(): number
  range(r: Range): number
  pick<T>(list: readonly T[]): T
  /** An exponential wait with this mean: mostly short, now and then long. */
  exp(mean: number): number
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0 || 0x9e3779b9
  const next = () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    range: (r) => (Array.isArray(r) ? r[0] + (r[1] - r[0]) * next() : r),
    pick: (list) => list[Math.floor(next() * list.length)],
    exp: (mean) => -Math.log(1 - next()) * mean,
  }
}
