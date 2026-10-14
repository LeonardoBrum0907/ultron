// The soul's clocks, as it is summoned out of the dust and dissolves back into it.
// rest: every particle in the dust; up: the currents carry it in (asm counts up, and
// keeps counting once it has formed); down: it falls apart, the assembly running
// backwards a few times faster, then rests again.

import { ASSEMBLY_END } from './swarm.js'

/** Seconds the dissolve runs back for each second of the assembly. */
const BACK = 2.6

/**
 * @typedef {object} AssemblyClocks what the shader needs, this frame
 * @property {number} asm s since the summons (-1 at rest): uAsm
 * @property {number} fire the fire's own clock, faster while it flares: uFire
 * @property {number} bootAt the free clock when the summons came (1e9 at rest): uBootAt
 * @property {number} live 1 while dissolving: uLive
 * @property {boolean} landed the last particle has just landed (time to draw new currents)
 */

/**
 * @typedef {object} Assembly
 * @property {'rest' | 'up' | 'down'} mode
 * @property {(now: number) => void} summon from the dust (or, dissolving, as soon as it rests)
 * @property {() => void} dissolve back into the dust
 * @property {(now: number) => void} replay dissolve, then summon again
 * @property {(dt: number, now: number, warp?: number) => AssemblyClocks} tick
 */

/**
 * The soul's clocks. now is the free clock (uTime), in seconds.
 * @param {number} [end] when the last particle lands, s after the summons
 * @returns {Assembly}
 * @example const a = createAssembly(); a.summon(0); a.tick(0.016, 0.016).asm // 0.016
 */
export function createAssembly(end = ASSEMBLY_END) {
  const s = { mode: 'rest', asm: -1, fire: 0, bootAt: 1e9, again: false, landed: false }
  const summon = (now) => {
    if (s.mode === 'down') s.again = true
    if (s.mode !== 'rest') return
    Object.assign(s, { mode: 'up', asm: 0, fire: 0, bootAt: now, landed: false })
  }
  const dissolve = () => {
    if (s.mode !== 'up') return
    Object.assign(s, { mode: 'down', asm: Math.min(s.asm, end), again: false })
  }
  return {
    get mode() {
      return s.mode
    },
    summon,
    dissolve,
    replay(now) {
      if (s.mode === 'rest') return summon(now)
      dissolve()
      s.again = true
    },
    tick: (dt, now, warp = 1) => advance(s, { dt, now, warp, end, summon }),
  }
}

function advance(s, { dt, now, warp, end, summon }) {
  let landed = false
  if (s.mode !== 'rest') s.fire += dt * warp
  if (s.mode === 'up') {
    s.asm += dt
    landed = !s.landed && s.asm >= end
    s.landed ||= landed
  } else if (s.mode === 'down') {
    s.asm -= dt * BACK
    if (s.asm <= -0.2) settle(s, now, summon)
  }
  return { asm: s.asm, fire: s.fire, bootAt: s.bootAt, live: s.mode === 'down' ? 1 : 0, landed }
}

// Back in the dust; summoned again straight away if that was asked for meanwhile.
function settle(s, now, summon) {
  const again = s.again
  Object.assign(s, { mode: 'rest', asm: -1, bootAt: 1e9, again: false })
  if (again) summon(now)
}
