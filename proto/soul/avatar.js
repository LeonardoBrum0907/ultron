// The soul as an avatar: already formed (no dust, no summons), on a see-through canvas,
// its colour, energy and pace set by the state a project gives it (avatar-states.js).
// It draws with the same shader as the soul page (stage.js), so it moves the same way.

import * as THREE from 'three'
import { easeAvatarState, stateOf, AVATAR_STATES } from './avatar-states.js'
import { fitSoul, makeSoulPoints, makeSoulUniforms } from './stage.js'
import { ASSEMBLY_END, buildSwarm, seededRandom } from './swarm.js'
import { createTint } from './tint.js'
import { createTouch } from './touch.js'

/** What of the soul an avatar shows: under the heart's glow to the smoke's top. */
export const AVATAR_FRAME = { bottom: -2.0, top: 9.0, minWidth: 5.6 }

/** How many particles each quality has, and how much brighter each is to make up for fewer. */
export const AVATAR_QUALITY = {
  full: { parts: { core: 16000, halo: 1500, flame: 46000, smoke: 14000, ember: 350 }, density: 1 },
  lite: { parts: { core: 6000, halo: 600, flame: 16000, smoke: 5000, ember: 200 }, density: 2.8 },
}

const FLARE_FADE = 1.4 // s for a flare to die down, as on the soul page

/**
 * @typedef {object} SoulAvatar
 * @property {(name: string) => void} setState a key of its states; colour, energy and pace follow gradually
 * @property {(level: number) => void} setLevel a voice or any signal, 0..1, lifting the fire while it lasts
 * @property {() => void} flare the fire flares up for a moment
 * @property {(xPx: number, yPx: number) => void} pointer the cursor, in CSS px from the box's top left
 * @property {(width: number, height: number, dpr: number) => void} resize the box, in CSS px
 * @property {() => void} start draws every frame (it starts drawing at once)
 * @property {() => void} stop stops drawing (off screen, say)
 * @property {(dt: number) => void} step one frame, dt s later (for recording frame by frame)
 * @property {number} particles
 * @property {() => void} dispose
 */

/**
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas where it draws
 * @param {keyof typeof AVATAR_QUALITY} [opts.quality]
 * @param {Record<string, import('./avatar-states.js').AvatarState>} [opts.states]
 * @param {string} [opts.state] the one it starts in
 * @returns {SoulAvatar}
 * @example const avatar = createSoulAvatar({ canvas, state: 'calm' }); avatar.setState('angry')
 */
export function createSoulAvatar({ canvas, quality = 'full', states = AVATAR_STATES, state = 'calm' }) {
  const look = qualityOf(quality)
  const first = stateOf(state, states)
  const draw = makeDrawing(canvas, look)
  const tint = createTint(first.palette)
  const mood = easeAvatarState(first)
  const touch = createTouch(draw.view, (AVATAR_FRAME.top + AVATAR_FRAME.bottom) / 2)
  const s = { now: 0, fire: ASSEMBLY_END, flare: 0, voice: 0, voiceAim: 0, raf: 0, last: 0 }

  function step(dt) {
    const { energy, pace } = mood.tick(dt)
    s.now += dt
    s.flare *= Math.exp(-dt / (FLARE_FADE / 3))
    s.voice += (s.voiceAim - s.voice) * Math.min(1, dt * (s.voiceAim > s.voice ? 12 : 3))
    const level = Math.min(1, energy + s.voice)
    s.fire += dt * pace * (1 + 0.4 * s.flare + 0.3 * level)
    tint.tick(dt, draw.uniforms)
    touch.tick(dt, draw.uniforms)
    setAvatarClocks(draw.uniforms, s, level)
    draw.render()
  }
  const loop = (ms) => {
    s.raf = requestAnimationFrame(loop)
    step(Math.min(0.1, (ms - (s.last || ms)) / 1000))
    s.last = ms
  }
  const stop = () => void (cancelAnimationFrame(s.raf), (s.raf = 0), (s.last = 0))
  const start = () => void (s.raf || (s.raf = requestAnimationFrame(loop)))
  start()

  return {
    setState(name) {
      const next = stateOf(name, states)
      tint.pick(next.palette)
      mood.aim(next)
    },
    setLevel: (level) => void (s.voiceAim = Math.max(0, Math.min(1, level))),
    flare: () => void (s.flare = 1),
    pointer: (xPx, yPx) => touch.move(xPx, yPx),
    resize: (width, height, dpr) => draw.resize(width, height, dpr),
    start,
    stop,
    step,
    particles: draw.particles,
    dispose: () => (stop(), draw.dispose()),
  }
}

function qualityOf(name) {
  const look = AVATAR_QUALITY[name]
  if (!look) throw new Error(`unknown avatar quality "${name}", expected one of ${Object.keys(AVATAR_QUALITY).join(', ')}`)
  return look
}

// The renderer, its scene and the box it fits, on a see-through canvas.
function makeDrawing(canvas, look) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, premultipliedAlpha: true })
  renderer.setClearColor(0x000000, 0)
  const uniforms = makeSoulUniforms()
  uniforms.uDensity.value = look.density
  const swarm = buildSwarm({ ...look.parts, dust: 0 }, seededRandom(1))
  const points = makeSoulPoints(swarm, uniforms, { clear: 'none' })
  const scene = new THREE.Scene()
  scene.add(points)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1)
  const view = { pxPerUnit: 1, vw: 1, vh: 1 }
  return {
    uniforms,
    view,
    particles: swarm.count,
    render: () => renderer.render(scene, camera),
    resize: (width, height, dpr) => fitSoul(renderer, uniforms, view, AVATAR_FRAME, { width, height, dpr }),
    dispose: () => (points.geometry.dispose(), points.material.dispose(), renderer.dispose()),
  }
}

// Formed for good: every particle has landed (uAsm far past the summons), and the fire's
// clock starts past the last landing, so it is all alight from the first frame.
function setAvatarClocks(uniforms, s, level) {
  uniforms.uTime.value = s.now
  uniforms.uFire.value = s.fire
  uniforms.uAsm.value = 1e4
  uniforms.uBootAt.value = 0
  uniforms.uLive.value = 0
  uniforms.uFlare.value = s.flare
  uniforms.uLevel.value = level
}
