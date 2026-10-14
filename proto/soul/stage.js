// What every soul draws with, the summoned one (soul.js) and the avatar (avatar.js): the
// uniforms its shader reads, its particles as one THREE.Points, and how it fits a box.

import * as THREE from 'three'
import { SOUL_PALETTE_NAMES, SOUL_PALETTES } from './palettes.js'
import { SOUL_FRAGMENT, SOUL_VERTEX } from './shaders.js'
import { CURRENTS } from './swarm.js'
import { TRAIL_N } from './touch.js'

/**
 * @typedef {object} SoulFrame what of the soul a box shows, in world units (the heart's radius)
 * @property {number} bottom
 * @property {number} top
 * @property {number} minWidth at least this wide in a narrow box
 */

/**
 * @typedef {object} SoulView the box the soul is drawn in, kept up to date by fitSoul
 * @property {number} pxPerUnit CSS px per world unit
 * @property {number} vw CSS px wide
 * @property {number} vh CSS px high
 */

/**
 * The uniforms the soul's shader reads, all at rest.
 * @returns {Record<string, { value: unknown }>}
 * @example const uniforms = makeSoulUniforms(); uniforms.uTime.value = 1
 */
export function makeSoulUniforms() {
  const v4s = () => Array.from({ length: CURRENTS }, () => new THREE.Vector4())
  return {
    uTime: { value: 0 },
    uFire: { value: 0 },
    uAsm: { value: -1 },
    uBootAt: { value: 1e9 },
    uLive: { value: 0 },
    uCloud: { value: new THREE.Vector3() },
    uWedge: { value: new Array(CURRENTS).fill(0) },
    uCurEnds: { value: v4s() },
    uCurMids: { value: v4s() },
    uTrail: { value: Array.from({ length: TRAIL_N }, () => new THREE.Vector4(0, -100, 0, 0)) },
    uFlare: { value: 0 },
    uLevel: { value: 0 },
    uPalHot: { value: paletteTable('hot') },
    uPalMid: { value: paletteTable('mid') },
    uPalCool: { value: paletteTable('cool') },
    uMix: { value: new Array(SOUL_PALETTE_NAMES.length).fill(0) },
    uMixWas: { value: new Array(SOUL_PALETTE_NAMES.length).fill(0) },
    uShift: { value: 0 },
    uView: { value: new THREE.Vector2(1, 1) },
    uYMid: { value: 0 },
    uPx: { value: 1 },
    uDensity: { value: 1 },
  }
}

// One shade of every palette, in SOUL_PALETTE_NAMES order: the shader's table of them.
function paletteTable(shade) {
  return SOUL_PALETTE_NAMES.map((name) => new THREE.Color(...SOUL_PALETTES[name][shade]))
}

/**
 * The particles of a swarm (swarm.js) as one THREE.Points, drawn by the soul's shader.
 * Its light adds up, over black, or over a see-through canvas (clear: 'none'), where it
 * also adds up how opaque it is, so it glows over whatever page is behind it.
 * @param {import('./swarm.js').SoulSwarm} swarm
 * @param {Record<string, { value: unknown }>} uniforms from makeSoulUniforms
 * @param {{ clear?: 'black' | 'none' }} [opts]
 * @returns {THREE.Points}
 * @example scene.add(makeSoulPoints(buildSwarm(SOUL_BUDGET, seededRandom(1)), uniforms))
 */
export function makeSoulPoints(swarm, uniforms, { clear = 'black' } = {}) {
  const geometry = new THREE.BufferGeometry()
  // three draws as many points as `position` has; the shader never reads it.
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(swarm.count * 3), 3))
  geometry.setAttribute('aRand', new THREE.BufferAttribute(swarm.rand, 4))
  geometry.setAttribute('aMeta', new THREE.BufferAttribute(swarm.meta, 4))
  geometry.setAttribute('aFly', new THREE.BufferAttribute(swarm.fly, 4))
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SOUL_VERTEX,
    fragmentShader: SOUL_FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    ...(clear === 'none' ? GLOW_OVER_PAGE : { blending: THREE.AdditiveBlending }),
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  return points
}

/**
 * Hands the shader the currents of one summons (currents.js rollCurrents).
 * @param {Record<string, { value: any }>} uniforms from makeSoulUniforms
 * @param {import('./currents.js').Currents} currents
 * @example setCurrents(uniforms, rollCurrents(seededRandom(3), cloud))
 */
export function setCurrents(uniforms, { wedges, ends, mids }) {
  uniforms.uWedge.value = wedges
  ends.forEach((e, k) => uniforms.uCurEnds.value[k].set(...e))
  mids.forEach((m, k) => uniforms.uCurMids.value[k].set(...m))
}

// Colour adds as light; opacity adds too, so the canvas holds premultiplied light.
const GLOW_OVER_PAGE = {
  blending: THREE.CustomBlending,
  blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneFactor,
}

/**
 * Sizes the renderer to a box and frames the soul in it, as large as the frame allows.
 * @param {THREE.WebGLRenderer} renderer
 * @param {Record<string, { value: any }>} uniforms from makeSoulUniforms
 * @param {SoulView} view updated in place
 * @param {SoulFrame} frame
 * @param {{ width: number, height: number, dpr: number }} box CSS px, and device px per CSS px
 * @example fitSoul(renderer, uniforms, view, { bottom: -3, top: 9, minWidth: 6.5 }, { width: 800, height: 600, dpr: 1 })
 */
export function fitSoul(renderer, uniforms, view, frame, box) {
  renderer.setPixelRatio(box.dpr)
  renderer.setSize(box.width, box.height, false)
  frameSoul(uniforms, view, frame, box)
}

/**
 * Frames the soul in a box, as large as the frame allows, without touching the renderer
 * (for a soul drawn in someone else's scene, sized by its owner).
 * @param {Record<string, { value: any }>} uniforms from makeSoulUniforms
 * @param {SoulView} view updated in place
 * @param {SoulFrame} frame
 * @param {{ width: number, height: number, dpr: number }} box CSS px, and device px per CSS px
 * @example frameSoul(uniforms, view, { bottom: -3, top: 9, minWidth: 6.5 }, { width: 800, height: 600, dpr: 1 })
 */
export function frameSoul(uniforms, view, frame, box) {
  view.vw = box.width
  view.vh = box.height
  view.pxPerUnit = Math.min(view.vh / (frame.top - frame.bottom), view.vw / frame.minWidth)
  uniforms.uView.value.set((2 * view.pxPerUnit) / view.vw, (2 * view.pxPerUnit) / view.vh)
  uniforms.uYMid.value = (frame.top + frame.bottom) / 2
  uniforms.uPx.value = view.pxPerUnit * box.dpr
}
