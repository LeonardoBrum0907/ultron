// The soul eater: a glowing orb wrapped in blue fire, smoke curling off the tip.
// Like the figure, every particle is placed by the vertex shader (shaders.js); the CPU
// only moves a handful of uniforms: the clock, a click's flare, the cursor's push and
// the microphone.

import * as THREE from 'three'
import { buildSwarm, seededRandom, SOUL_BUDGET } from './swarm.js'
import { SOUL_FRAGMENT, SOUL_VERTEX } from './shaders.js'
import { SOUL_PALETTES } from './palettes.js'

// What the screen shows, in world units (the orb's radius): from under the orb to the
// smoke's top, and at least this wide on a narrow window.
const VIEW = { bottom: -3.0, top: 9.0, minWidth: 6.5 }
const FLARE_FADE = 1.4 // s for a click's flare to die down
const WIND_FADE = 0.7 // s for the cursor's push to die down
const WIND_MAX = 1.6 // world units the tips can be pushed

/**
 * @typedef {object} Soul
 * @property {() => void} flare the fire flares up (a click)
 * @property {(dxPx: number, dyPx: number) => void} push the cursor moved this many CSS px
 * @property {(name: string) => void} setPalette a key of SOUL_PALETTES
 * @property {number} particles how many particles it has
 * @property {() => void} dispose
 */

/**
 * Builds the soul on a canvas and keeps it burning.
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas where it draws (the whole window)
 * @param {(dt: number, clock: number) => number} [opts.hears] how loud the microphone is now, 0..1
 * @param {number} [opts.seed] which soul (the particles' random numbers)
 * @returns {Soul}
 * @example const soul = createSoul({ canvas: document.querySelector('canvas') }); soul.flare()
 */
export function createSoul({ canvas, hears = () => 0, seed = 1 }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' })
  renderer.setClearColor(0x000000, 1)
  const uniforms = makeUniforms()
  const swarm = buildSwarm(SOUL_BUDGET, seededRandom(seed))
  const points = makePoints(swarm, uniforms)
  const scene = new THREE.Scene()
  scene.add(points)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1)
  const state = { pxPerUnit: 1, flare: 0, wind: new THREE.Vector2(), last: performance.now(), raf: 0 }

  const resize = () => layout(renderer, uniforms, state)
  window.addEventListener('resize', resize)
  resize()
  setPalette(uniforms, 'blue')

  function frame(nowMs) {
    state.raf = requestAnimationFrame(frame)
    const dt = Math.min(0.1, (nowMs - state.last) / 1000)
    state.last = nowMs
    tick(uniforms, state, dt, hears(dt, nowMs / 1000))
    renderer.render(scene, camera)
  }
  state.raf = requestAnimationFrame(frame)

  return {
    flare: () => void (state.flare = 1),
    push: (dxPx, dyPx) => pushWind(state, dxPx, dyPx),
    setPalette: (name) => setPalette(uniforms, name),
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

function makeUniforms() {
  return {
    uTime: { value: 0 },
    uFlare: { value: 0 },
    uLevel: { value: 0 },
    uWind: { value: new THREE.Vector2() },
    uHot: { value: new THREE.Color() },
    uMid: { value: new THREE.Color() },
    uCool: { value: new THREE.Color() },
    uView: { value: new THREE.Vector2(1, 1) },
    uYMid: { value: 0 },
    uPx: { value: 1 },
  }
}

function makePoints(swarm, uniforms) {
  const geometry = new THREE.BufferGeometry()
  // three draws as many points as `position` has; the shader never reads it.
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(swarm.count * 3), 3))
  geometry.setAttribute('aRand', new THREE.BufferAttribute(swarm.rand, 4))
  geometry.setAttribute('aMeta', new THREE.BufferAttribute(swarm.meta, 2))
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SOUL_VERTEX,
    fragmentShader: SOUL_FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  return points
}

function layout(renderer, uniforms, state) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  renderer.setPixelRatio(dpr)
  renderer.setSize(vw, vh, false)
  state.pxPerUnit = Math.min(vh / (VIEW.top - VIEW.bottom), vw / VIEW.minWidth)
  uniforms.uView.value.set((2 * state.pxPerUnit) / vw, (2 * state.pxPerUnit) / vh)
  uniforms.uYMid.value = (VIEW.top + VIEW.bottom) / 2
  uniforms.uPx.value = state.pxPerUnit * dpr
}

function tick(uniforms, state, dt, level) {
  state.flare *= Math.exp(-dt / (FLARE_FADE / 3))
  state.wind.multiplyScalar(Math.exp(-dt / WIND_FADE))
  uniforms.uTime.value += dt
  uniforms.uFlare.value = state.flare
  uniforms.uWind.value.copy(state.wind)
  // The voice lifts the fire quickly and lets it settle slowly.
  const ease = level > uniforms.uLevel.value ? 12 : 3
  uniforms.uLevel.value += (level - uniforms.uLevel.value) * Math.min(1, dt * ease)
}

function pushWind(state, dxPx, dyPx) {
  // Screen y runs down; the soul's runs up.
  state.wind.x += (dxPx / state.pxPerUnit) * 0.35
  state.wind.y -= (dyPx / state.pxPerUnit) * 0.35
  state.wind.clampLength(0, WIND_MAX)
}

function setPalette(uniforms, name) {
  const palette = SOUL_PALETTES[name]
  if (!palette) throw new Error(`unknown soul palette "${name}", expected one of ${Object.keys(SOUL_PALETTES).join(', ')}`)
  uniforms.uHot.value.setRGB(...palette.hot)
  uniforms.uMid.value.setRGB(...palette.mid)
  uniforms.uCool.value.setRGB(...palette.cool)
}
