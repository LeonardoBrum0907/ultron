// The cursor on the soul: its recent path (uTrail: the shader's stir pushes the particles
// it passed aside, and they drift back as the wake closes). That push is all it does: the
// fire keeps to its own sway, it does not follow the cursor (Léo asked for that).

const SPEED_EASE = 10 // how quickly the cursor's measured speed follows it, 1/s
const SPEED_MAX = 8 // world units/s the wake takes from the cursor at most
export const TRAIL_N = 8 // the shader's uTrail is this long
const TRAIL_STEP = 0.06 // s between the path's samples
const TRAIL_FADE = 0.45 // s for a sample's wake to close

/**
 * @typedef {object} Touch
 * @property {(xPx: number, yPx: number) => void} move the cursor is here now (CSS px)
 * @property {(dt: number, uniforms: object) => void} tick eases it and sets uTrail
 */

/**
 * @param {{ pxPerUnit: number, vw: number, vh: number }} view the window, kept up to date by its owner
 * @param {number} yMid world y at the middle of the window
 * @returns {Touch}
 * @example const touch = createTouch(view, 3); touch.move(640, 400); touch.tick(0.016, uniforms)
 */
export function createTouch(view, yMid) {
  const s = { x: 0, y: -100, dx: 0, dy: 0, vx: 0, vy: 0, seen: false, clock: 0, sampledAt: 0 }
  const trail = [] // newest first: { x, y, vx, vy, at }
  return {
    move(xPx, yPx) {
      // Screen y runs down; the soul's runs up.
      const x = (xPx - view.vw / 2) / view.pxPerUnit
      const y = yMid - (yPx - view.vh / 2) / view.pxPerUnit
      if (s.seen) [s.dx, s.dy] = [s.dx + x - s.x, s.dy + y - s.y]
      Object.assign(s, { x, y, seen: true })
    },
    tick(dt, uniforms) {
      s.clock += dt
      easeSpeed(s, dt)
      sample(s, trail)
      // The path starts where the cursor is now and runs back through its samples.
      const path = [{ x: s.x, y: s.y, vx: s.vx, vy: s.vy, at: s.clock }, ...trail]
      uniforms.uTrail.value.forEach((v, i) => setSample(v, path[i], s.clock))
    },
  }
}

function easeSpeed(s, dt) {
  const k = Math.min(1, dt * SPEED_EASE)
  const step = Math.max(dt, 1e-3)
  s.vx += (s.dx / step - s.vx) * k
  s.vy += (s.dy / step - s.vy) * k
  s.dx = 0
  s.dy = 0
}

// Every TRAIL_STEP the cursor leaves a sample of where it is and how fast it goes.
function sample(s, trail) {
  if (s.clock - s.sampledAt < TRAIL_STEP) return
  s.sampledAt = s.clock
  const speed = Math.hypot(s.vx, s.vy)
  const k = speed > SPEED_MAX ? SPEED_MAX / speed : 1
  trail.unshift({ x: s.x, y: s.y, vx: s.vx * k, vy: s.vy * k, at: s.clock })
  trail.length = Math.min(trail.length, TRAIL_N - 1)
}

// A sample as the shader takes it: where it is, and its velocity faded by its age.
function setSample(v, sample, clock) {
  if (!sample) return v.set(0, -100, 0, 0)
  const fade = Math.exp(-(clock - sample.at) / TRAIL_FADE)
  v.set(sample.x, sample.y, sample.vx * fade, sample.vy * fade)
}
