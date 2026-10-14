// The soul as one of Ultron's forms (figure.js). Asleep, he is a soul of fire: it gathers
// out of his dust as the figure comes apart, and goes back into the dust as he wakes,
// carried both ways by currents of wind like the figure's own. Its colours (as many as the
// emotions he feels), how high it burns and how fast it moves follow his mood (moods.js). It draws in the figure's own scene, over
// the same black, so it owns no renderer: the figure sizes it (resize) and moves it on
// (tick) every frame.
//
// His dust stands in for the soul's: the soul brings none of its own, and its particles,
// resting in the dust before they are summoned, fade in under his as he comes apart and fade
// out once they are back in it (presence).

import { createAssembly } from './assembly.js'
import { easeAvatarState } from './avatar-states.js'
import { dustCloud, rollCurrents } from './currents.js'
import { soulLookOf } from './moods.js'
import { frameSoul, makeSoulPoints, makeSoulUniforms, setCurrents } from './stage.js'
import { ASSEMBLY_END, buildSwarm, seededRandom, SOUL_BUDGET } from './swarm.js'
import { createTint, mixDistance } from './tint.js'
import { createTouch } from './touch.js'

/** What of the soul the window shows: the soul page's frame, so it looks the same. */
const FRAME = { bottom: -3.0, top: 9.0, minWidth: 6.5 }
/** s from asking for the soul to its summons, so the figure is seen to come apart first. */
export const SUMMON_AFTER = 0.8
/** s for the soul's resting particles to fade in, and out once they are back in the dust. */
export const FADE = { in: 1.2, out: 1.6 }
const FLARE_FADE = 1.4 // s for a flare to die down, as on the soul page
// How far his mood's mix of colours moves (tint.js mixDistance, 0..2) before the fire turns to
// it: his emotions drift all the time, and each turn spreads from the ember again.
const MIX_STEP = 0.1

/**
 * @typedef {object} SoulFormFrame how the soul is this frame, for the figure
 * @property {number} presence 0..1: how much of it is on screen, its resting dust included
 * @property {number} motion 0..1: how much of it is in flight (the figure's MOTION.assembly)
 */

/**
 * @typedef {object} SoulForm
 * @property {import('three').Points} points add it to the scene it draws in
 * @property {() => void} show summon it out of the dust (he falls asleep)
 * @property {() => void} hide dissolve it back into the dust (he wakes, or powers down)
 * @property {() => boolean} present whether any of it is on screen
 * @property {() => boolean} formed whether it is summoned (gathering or whole)
 * @property {() => void} flare the fire flares up for a moment
 * @property {(xPx: number, yPx: number) => void} pointer the cursor, CSS px in the window
 * @property {(width: number, height: number, dpr: number) => void} resize the window, CSS px
 * @property {(dt: number, mind: Parameters<typeof soulLookOf>[0]) => SoulFormFrame} tick one frame, with the mind's output
 * @property {number} particles
 * @property {() => void} dispose
 */

/**
 * The soul, resting unseen in the dust until it is shown.
 * @param {{ seed?: number }} [opts] seed: which soul (the particles' random numbers)
 * @returns {SoulForm}
 * @example const soul = createSoulForm(); scene.add(soul.points); soul.resize(1280, 720, 1); soul.show()
 */
export function createSoulForm({ seed = 1 } = {}) {
  const uniforms = makeSoulUniforms()
  const swarm = buildSwarm({ ...SOUL_BUDGET, dust: 0 }, seededRandom(seed))
  const points = makeSoulPoints(swarm, uniforms)
  points.visible = false
  const view = { pxPerUnit: 1, vw: 1, vh: 1 }
  const touch = createTouch(view, (FRAME.top + FRAME.bottom) / 2)
  const assembly = createAssembly()
  const s = { now: 0, wanted: false, summonAt: Infinity, presence: 0, flare: 0, cloud: null, look: null }

  const newCurrents = () => setCurrents(uniforms, rollCurrents(seededRandom((Math.random() * 2 ** 32) >>> 0), s.cloud))
  return {
    points,
    show() {
      if (s.wanted) return
      // Fresh from the dust, it takes his mood as it is, with no change of colour to show.
      if (s.presence === 0) s.look = null
      // Still going back into the dust, it is summoned again as soon as it rests there.
      Object.assign(s, { wanted: true, summonAt: s.now + (assembly.mode === 'rest' ? SUMMON_AFTER : 0) })
    },
    hide() {
      Object.assign(s, { wanted: false, summonAt: Infinity })
      assembly.dissolve()
    },
    present: () => s.presence > 0,
    formed: () => assembly.mode === 'up',
    flare: () => void (s.flare = 1),
    pointer: (xPx, yPx) => touch.move(xPx, yPx),
    resize(width, height, dpr) {
      frameSoul(uniforms, view, FRAME, { width, height, dpr })
      // Sized from the window it first meets, like the figure's own dust.
      if (s.cloud) return
      s.cloud = dustCloud(view, FRAME)
      uniforms.uCloud.value.set(s.cloud.cx, s.cloud.cy, s.cloud.R)
      newCurrents()
    },
    tick(dt, mind) {
      s.now += dt
      if (s.wanted && s.now >= s.summonAt && assembly.mode === 'rest') summonNow()
      s.presence = towards(s.presence, s.wanted || assembly.mode !== 'rest' ? 1 : 0, dt)
      points.visible = s.presence > 0
      if (!points.visible) return { presence: 0, motion: 0 }
      return { presence: s.presence, motion: moveOn(dt, soulLookOf(mind)) }
    },
    particles: swarm.count,
    dispose: () => (points.geometry.dispose(), points.material.dispose()),
  }

  function summonNow() {
    s.summonAt = Infinity
    assembly.summon(s.now)
  }

  // The fire follows the mood and the clocks run on; returns how much of it is in flight.
  function moveOn(dt, look) {
    const { energy, pace } = follow(look).tick(dt)
    s.flare = Math.max(s.flare * Math.exp(-dt / (FLARE_FADE / 3)), look.boost)
    const level = Math.min(1, energy)
    const clocks = assembly.tick(dt, s.now, pace * (1 + 0.4 * s.flare + 0.3 * level))
    if (clocks.landed) newCurrents() // for the dissolve and the next summons
    touch.tick(dt, uniforms)
    s.look.tint.tick(dt, uniforms)
    setFormClocks(uniforms, s, clocks, level)
    // Its presence fades every particle in and out, and a sigh or a pleased moment dims or
    // brightens the fire (uDensity is how bright each particle is).
    uniforms.uDensity.value = s.presence * look.glow
    return motionOf(assembly.mode, clocks.asm)
  }

  // The colours turn to the mood's mix (tint.js) and the energy and pace ease to the mood's.
  function follow(look) {
    if (!s.look) s.look = { tint: createTint(look.mix), mood: easeAvatarState(look) }
    if (mixDistance(look.mix, s.look.tint.target()) > MIX_STEP) s.look.tint.pick(look.mix)
    s.look.mood.aim(look)
    return s.look.mood
  }
}

// Presence moves linearly, quicker to come than to go.
function towards(now, aim, dt) {
  if (aim > now) return Math.min(aim, now + dt / FADE.in)
  return Math.max(aim, now - dt / FADE.out)
}

function setFormClocks(uniforms, s, clocks, level) {
  uniforms.uTime.value = s.now
  uniforms.uFire.value = clocks.fire
  uniforms.uAsm.value = clocks.asm
  uniforms.uBootAt.value = clocks.bootAt
  uniforms.uLive.value = clocks.live
  uniforms.uFlare.value = s.flare
  uniforms.uLevel.value = level
}

/**
 * How much of the soul is in flight, 0..1, for the sound of the dust (figure.js MOTION).
 * @param {'rest' | 'up' | 'down'} mode the assembly's
 * @param {number} asm s since the summons (uAsm)
 * @returns {number}
 * @example motionOf('up', 4) // 1: the currents are full
 */
export function motionOf(mode, asm) {
  if (mode === 'up') return smooth(0, 1.2, asm) * (1 - smooth(ASSEMBLY_END - 2.4, ASSEMBLY_END, asm))
  if (mode === 'down') return 0.8 * smooth(-0.2, 1.5, asm)
  return 0
}

function smooth(a, b, v) {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
