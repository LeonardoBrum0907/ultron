// The soul eater: a heart of fire in layers wrapped in blue flames, smoke curling off the
// tip, summoned out of a cloud of dust by currents of wind and dissolving back into it.
// Like the figure, every particle is placed by the vertex shader (shaders.js); the CPU
// only moves a handful of uniforms: the clocks, the currents, a click's flare, the cursor,
// the microphone and the colour (tint.js).

import * as THREE from 'three'
import { createAssembly } from './assembly.js'
import { rollCurrents } from './currents.js'
import { fitSoul, makeSoulPoints, makeSoulUniforms } from './stage.js'
import { buildSwarm, seededRandom, SOUL_BUDGET } from './swarm.js'
import { createTint } from './tint.js'
import { createTouch } from './touch.js'

// What the screen shows, in world units (the heart's radius): from under the heart to the
// smoke's top, and at least this wide on a narrow window.
const VIEW = { bottom: -3.0, top: 9.0, minWidth: 6.5 }
const FLARE_FADE = 1.4 // s for a click's flare to die down

/**
 * @typedef {object} Soul
 * @property {() => void} click summons it from the dust, or, formed, makes the fire flare up
 * @property {() => void} dissolve back into the dust
 * @property {() => void} replay dissolve, then summon again (new currents every time)
 * @property {(xPx: number, yPx: number) => void} pointer the cursor is here now (CSS px)
 * @property {(name: string) => void} setPalette turns it to this colour, gradually (a key of SOUL_PALETTES)
 * @property {() => 'rest' | 'up' | 'down'} mode
 * @property {(seconds: number | null) => void} hold dev: freezes the summons at that moment (null lets go)
 * @property {number} particles how many particles it has
 * @property {() => void} dispose
 */

/**
 * Builds the soul on a canvas, resting in the dust until it is summoned.
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas where it draws (the whole window)
 * @param {(dt: number, clock: number) => number} [opts.hears] how loud the microphone is now, 0..1
 * @param {number} [opts.seed] which soul (the particles' random numbers); the currents are new every summons
 * @returns {Soul}
 * @example const soul = createSoul({ canvas: document.querySelector('canvas') }); soul.click()
 */
export function createSoul({ canvas, hears = () => 0, seed = 1 }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' })
  renderer.setClearColor(0x000000, 1)
  const uniforms = makeSoulUniforms()
  const swarm = buildSwarm(SOUL_BUDGET, seededRandom(seed))
  const points = makeSoulPoints(swarm, uniforms)
  const scene = new THREE.Scene()
  scene.add(points)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1)
  const view = { pxPerUnit: 1, vw: 1, vh: 1 }
  const resize = () => layout(renderer, uniforms, view)
  window.addEventListener('resize', resize)
  resize()
  const cloud = dustCloud(view)
  uniforms.uCloud.value.set(cloud.cx, cloud.cy, cloud.R)
  const newCurrents = () => setCurrents(uniforms, rollCurrents(seededRandom((Math.random() * 2 ** 32) >>> 0), cloud))
  newCurrents()
  const tint = createTint('blue')
  const assembly = createAssembly()
  const touch = createTouch(view, (VIEW.top + VIEW.bottom) / 2)
  const state = { flare: 0, now: 0, last: performance.now(), raf: 0, hold: null }

  function frame(nowMs) {
    state.raf = requestAnimationFrame(frame)
    const dt = Math.min(0.1, (nowMs - state.last) / 1000)
    state.last = nowMs
    state.now += dt
    state.flare *= Math.exp(-dt / (FLARE_FADE / 3))
    const level = easeLevel(uniforms, dt, hears(dt, nowMs / 1000))
    const ticked = assembly.tick(dt, state.now, 1 + 0.4 * state.flare + 0.3 * level)
    const clocks = state.hold == null ? ticked : held(state)
    if (clocks.landed) newCurrents() // for the dissolve and the next summons
    touch.tick(dt, uniforms)
    tint.tick(dt, uniforms)
    setClocks(uniforms, state, clocks)
    renderer.render(scene, camera)
  }
  state.raf = requestAnimationFrame(frame)

  return {
    click: () => (assembly.mode === 'up' ? void (state.flare = 1) : assembly.summon(state.now)),
    dissolve: () => assembly.dissolve(),
    replay: () => assembly.replay(state.now),
    pointer: (xPx, yPx) => touch.move(xPx, yPx),
    setPalette: (name) => tint.pick(name),
    mode: () => assembly.mode,
    hold: (seconds) => void (state.hold = seconds),
    particles: swarm.count,
    dispose() {
      cancelAnimationFrame(state.raf)
      window.removeEventListener('resize', resize)
      points.geometry.dispose()
      points.material.dispose()
      renderer.dispose()
    },
  }
}

// The whole window, its device pixels capped so a big screen stays smooth.
function layout(renderer, uniforms, view) {
  const box = { width: window.innerWidth, height: window.innerHeight, dpr: Math.min(window.devicePixelRatio || 1, 1.5) }
  fitSoul(renderer, uniforms, view, VIEW, box)
}

// The dust at rest, sized from the window it starts in, so it reaches the edges of a
// wide monitor too (and, like Ultron's, it does not move when the window changes).
function dustCloud(view) {
  const w = view.vw / view.pxPerUnit
  const h = view.vh / view.pxPerUnit
  return { cx: 0, cy: (VIEW.top + VIEW.bottom) / 2, R: Math.max(9, 0.6 * Math.hypot(w, h)), reach: Math.hypot(w, h) }
}

// Dev: the summons frozen at state.hold seconds, as if it had begun that long ago.
function held(state) {
  return { asm: state.hold, fire: state.hold, bootAt: state.now - state.hold, live: 0, landed: false }
}

function setCurrents(uniforms, { wedges, ends, mids }) {
  uniforms.uWedge.value = wedges
  ends.forEach((e, k) => uniforms.uCurEnds.value[k].set(...e))
  mids.forEach((m, k) => uniforms.uCurMids.value[k].set(...m))
}

function setClocks(uniforms, state, clocks) {
  uniforms.uTime.value = state.now
  uniforms.uFlare.value = state.flare
  uniforms.uFire.value = clocks.fire
  uniforms.uAsm.value = clocks.asm
  uniforms.uBootAt.value = clocks.bootAt
  uniforms.uLive.value = clocks.live
}

// The voice lifts the fire quickly and lets it settle slowly.
function easeLevel(uniforms, dt, level) {
  const ease = level > uniforms.uLevel.value ? 12 : 3
  uniforms.uLevel.value += (level - uniforms.uLevel.value) * Math.min(1, dt * ease)
  return uniforms.uLevel.value
}
