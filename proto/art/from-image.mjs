// Source art for the particle humanoid, derived from an AI-made render.
//
//   node proto/art/from-image.mjs [proto/gen/v2.png]
//
// Reads one front-facing picture of the figure on black and writes the same set
// of layer PNGs the engine already knows (see generate.mjs) into proto/img-v2/.
// Nothing here is drawn by hand: the picture's edges, shading and red lights are
// sorted into layers, and the per-state overlays (the voice bars, the tooling's)
// are drawn on top at positions measured from the picture. The picture is used
// as it is, including whatever asymmetry the render has.
//
//   lines.png     cyan: seams and plate edges (valleys, steps and ridges in the render)
//   head-lines.png cyan: the head's seams as thin centre lines, and its lit bevels fainter
//   fill.png      cyan: the shading of the plates, so the body has volume
//   rim.png       cyan-white: the outline, the specular ridges and the halo outside
//   dust.png      cyan: a little dust shed around the outline
//   veins.png     red: every red light in the render (the engine runs an energy wave up it)
//   redrim.png    red: the glow the red lights spill onto the metal around them
//   lights.png    red: the hottest points (driven by state); the eyes are not in it, the engine draws them
//   chin.png      cyan: the chin emblem's outline and the edge where the head ends, a little denser than the lines
//   plates.png    grey, not drawn: how much metal lies over whatever runs under it (the arteries), 0 open .. 1 a plate
//   face-*.png    red: the glow of the face in each state
//   preview-*.png everything composited, for eyeballing
//   backdrop.png  copied from proto/img (the figure's own art is what changed)
//   meta.json     sizes, face zone, particle budgets, and the geometry the engine draws from
//                 (the arteries' course, the eyes, the mouth)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng, writePng } from './png.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(process.argv[2] ?? path.join(here, '..', 'gen', 'v2.png'))
const OUT = path.join(here, '..', 'img-v2')
fs.mkdirSync(OUT, { recursive: true })

// The canvas is the engine's usual 1024x1100; the render is 1024x1024 and sits
// at the bottom of it so the head has some air above.
const W = 1024
const H = 1100
const N = W * H
const CX = 512
const OY = H - 1024

const src = readPng(SRC)
if (src.w !== 1024 || src.h !== 1024) throw new Error(`expected a 1024x1024 render, got ${src.w}x${src.h}`)

/* ---------------------------------------------------------------- helpers */

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
function hash2(ix, iy) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function vnoise(x, y) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const u = fx * fx * (3 - 2 * fx)
  const v = fy * fy * (3 - 2 * fy)
  const l = (a, b, t) => a + (b - a) * t
  return l(l(hash2(ix, iy), hash2(ix + 1, iy), u), l(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), u), v)
}
const fbm = (x, y) => 0.5 * vnoise(x, y) + 0.25 * vnoise(x * 2.03, y * 2.03) + 0.125 * vnoise(x * 4.1, y * 4.1)

/** Box blur, a few passes: close enough to a gaussian of the given sigma. */
function blur(a, sigma) {
  const r = Math.max(1, Math.round(Math.sqrt(sigma * sigma + 0.25) - 0.5))
  let s = a
  let d = new Float32Array(N)
  const t = new Float32Array(N)
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < H; y++) {
      const base = y * W
      let acc = 0
      for (let k = -r; k <= r; k++) acc += s[base + clamp(k, 0, W - 1)]
      for (let x = 0; x < W; x++) {
        t[base + x] = acc / (2 * r + 1)
        acc += s[base + Math.min(x + r + 1, W - 1)] - s[base + Math.max(x - r, 0)]
      }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0
      for (let k = -r; k <= r; k++) acc += t[clamp(k, 0, H - 1) * W + x]
      for (let y = 0; y < H; y++) {
        d[y * W + x] = acc / (2 * r + 1)
        acc += t[Math.min(y + r + 1, H - 1) * W + x] - t[Math.max(y - r, 0) * W + x]
      }
    }
    s = d
    d = new Float32Array(N)
  }
  return s
}

/** Distance (px, 3-4 chamfer) from every pixel to the nearest pixel where target is 1. */
function distTo(target) {
  const INF = 1e7
  const d = new Int32Array(N)
  for (let i = 0; i < N; i++) d[i] = target[i] ? 0 : INF
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      let v = d[i]
      if (x > 0) v = Math.min(v, d[i - 1] + 3)
      if (y > 0) {
        v = Math.min(v, d[i - W] + 3)
        if (x > 0) v = Math.min(v, d[i - W - 1] + 4)
        if (x < W - 1) v = Math.min(v, d[i - W + 1] + 4)
      }
      d[i] = v
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x
      let v = d[i]
      if (x < W - 1) v = Math.min(v, d[i + 1] + 3)
      if (y < H - 1) {
        v = Math.min(v, d[i + W] + 3)
        if (x < W - 1) v = Math.min(v, d[i + W + 1] + 4)
        if (x > 0) v = Math.min(v, d[i + W - 1] + 4)
      }
      d[i] = v
    }
  }
  const out = new Float32Array(N)
  for (let i = 0; i < N; i++) out[i] = d[i] / 3
  return out
}

function sobel(a) {
  const out = new Float32Array(N)
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      const gx = a[i - W + 1] + 2 * a[i + 1] + a[i + W + 1] - a[i - W - 1] - 2 * a[i - 1] - a[i + W - 1]
      const gy = a[i + W - 1] + 2 * a[i + W] + a[i + W + 1] - a[i - W - 1] - 2 * a[i - W] - a[i - W + 1]
      out[i] = Math.hypot(gx, gy) / 4
    }
  }
  return out
}

/* ----------------------------------------------------------- the picture */

const R = new Float32Array(N)
const G = new Float32Array(N)
const B = new Float32Array(N)
for (let y = 0; y < 1024; y++) {
  for (let x = 0; x < 1024; x++) {
    const i = (y + OY) * W + x
    const s = (y * 1024 + x) * 3
    R[i] = src.rgb[s]
    G[i] = src.rgb[s + 1]
    B[i] = src.rgb[s + 2]
  }
}
const Y = new Float32Array(N)
for (let i = 0; i < N; i++) Y[i] = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i]

// The figure is whatever the black background does not reach from the frame's
// edge; cavities that are dark but enclosed stay part of it.
const bg = new Uint8Array(N)
{
  const stack = new Int32Array(N)
  let sp = 0
  const push = (i) => {
    if (!bg[i] && Y[i] < 0.05) {
      bg[i] = 1
      stack[sp++] = i
    }
  }
  for (let x = 0; x < W; x++) {
    push(x)
    push((H - 1) * W + x)
  }
  for (let y = 0; y < H; y++) {
    push(y * W)
    push(y * W + W - 1)
  }
  while (sp) {
    const i = stack[--sp]
    const x = i % W
    if (x > 0) push(i - 1)
    if (x < W - 1) push(i + 1)
    if (i >= W) push(i - W)
    if (i < N - W) push(i + W)
  }
}
const hull = new Uint8Array(N)
for (let i = 0; i < N; i++) hull[i] = bg[i] ? 0 : 1
const outside = new Uint8Array(N)
for (let i = 0; i < N; i++) outside[i] = hull[i] ? 0 : 1
const dIn = distTo(outside) // inside the figure: how far from its edge
const dOut = distTo(hull) // outside it: how far from the figure

// Where the render is red: the eyes, the vents, the joints, the cables.
const redRaw = new Float32Array(N)
const red = new Float32Array(N)
for (let i = 0; i < N; i++) {
  redRaw[i] = R[i] - 0.5 * (G[i] + B[i])
  red[i] = hull[i] ? smooth(0.05, 0.4, redRaw[i]) : 0
}

// The sides of the render are cut by the frame (the shoulders run off it), so
// the figure dissolves there instead of ending on a hard vertical edge.
const sideFade = new Float32Array(W)
for (let x = 0; x < W; x++) sideFade[x] = smooth(0, 120, x) * smooth(0, 120, W - 1 - x)

/* ------------------------------------------------------ edges and shading */

const Ys = blur(Y, 0.9)
const B3 = blur(Y, 3)
const grad = sobel(Ys)

const lineV = new Float32Array(N) // 0..1: where a seam, step or ridge runs
const hlV = new Float32Array(N) // 0..1: lit ridges
const fillV = new Float32Array(N) // 0..1: plate shading
for (let i = 0; i < N; i++) {
  if (!hull[i]) continue
  const edge = smooth(0.025, 0.12, grad[i])
  const seam = smooth(0.03, 0.16, B3[i] - Y[i])
  const hl = smooth(0.03, 0.18, Y[i] - B3[i])
  lineV[i] = clamp(Math.max(edge * 0.75, seam, hl * 0.5)) * smooth(1.5, 4, dIn[i])
  hlV[i] = hl
  fillV[i] = Math.pow(clamp(Ys[i] / 0.7), 1.4) * smooth(0.03, 0.12, Y[i])
}

/* ------------------------------------------------------- the head's seams */

// lineV above is several things at once (the gradient on both sides of a seam, the seam's
// own valley, the lit edge beside it, the scratches of the brushed metal), so each seam
// comes out as two or three blurred strokes. The head is small on screen and its seams are
// what it is made of, so there they are found as lines: across a seam the render is a thin
// valley (1-2 px dark, the gap between two plates), across a bevel a thin ridge (the lit edge
// of a plate). The Hessian at the seams' own scale tells both apart; each is thinned to its
// centre line (non-maximum suppression across it), kept where it is strong or joined to
// something strong (hysteresis), and bits shorter than 10 px, which are the metal's texture,
// are dropped. Seams at full weight, bevels at 0.45.

function gaussBlur(a, sigma) {
  const r = Math.ceil(sigma * 3)
  const k = []
  for (let i = -r; i <= r; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)))
  const sum = k.reduce((s, v) => s + v, 0)
  const t = new Float32Array(N)
  const o = new Float32Array(N)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) s += a[y * W + clamp(x + i, 0, W - 1)] * k[i + r]
      t[y * W + x] = s / sum
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) s += t[clamp(y + i, 0, H - 1) * W + x] * k[i + r]
      o[y * W + x] = s / sum
    }
  return o
}

/** Thin lines of the render: { str, nx, ny } for valleys (dark) or ridges (bright) at this scale. */
function lineField(L, sigma, dark) {
  const str = new Float32Array(N)
  const nx = new Float32Array(N)
  const ny = new Float32Array(N)
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      const xx = L[i - 1] - 2 * L[i] + L[i + 1]
      const yy = L[i - W] - 2 * L[i] + L[i + W]
      const xy = (L[i - W - 1] + L[i + W + 1] - L[i - W + 1] - L[i + W - 1]) / 4
      const tr = (xx + yy) / 2
      const d = Math.sqrt(((xx - yy) / 2) ** 2 + xy * xy)
      // across: the strongest curvature (up for a valley, down for a ridge); along: the other
      const across = dark ? tr + d : tr - d
      const along = dark ? tr - d : tr + d
      const s = (dark ? across : -across) - Math.abs(along) * 0.5
      if (s <= 0) continue
      str[i] = s * sigma * sigma
      let ex = xy
      let ey = across - xx
      let n = Math.hypot(ex, ey)
      if (n < 1e-9) [ex, ey, n] = xx * (dark ? 1 : -1) >= yy * (dark ? 1 : -1) ? [1, 0, 1] : [0, 1, 1]
      nx[i] = ex / n
      ny[i] = ey / n
    }
  return { str, nx, ny }
}

/** The centre lines of a line field: thinned, hysteresis hi/lo, pieces shorter than minLen px dropped. */
function centreLines({ str, nx, ny }, hi, lo, minLen) {
  const at = (x, y) => {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = x - x0
    const fy = y - y0
    const g = (a, b) => str[b * W + a]
    return (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy
  }
  const keep = new Float32Array(N)
  for (let y = 2; y < H - 2; y++)
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x
      if (str[i] >= lo && str[i] >= at(x + nx[i], y + ny[i]) && str[i] >= at(x - nx[i], y - ny[i])) keep[i] = str[i]
    }
  const seen = new Uint8Array(N)
  const out = new Float32Array(N)
  const stack = []
  for (let i = 0; i < N; i++) {
    if (keep[i] < lo || seen[i]) continue
    const piece = []
    let strong = false
    seen[i] = 1
    stack.push(i)
    while (stack.length) {
      const j = stack.pop()
      piece.push(j)
      if (keep[j] >= hi) strong = true
      const x = j % W
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const k = j + dy * W + dx
          if ((!dx && !dy) || x + dx < 0 || x + dx >= W || k < 0 || k >= N || seen[k] || keep[k] < lo) continue
          seen[k] = 1
          stack.push(k)
        }
    }
    if (strong && piece.length >= minLen) for (const j of piece) out[j] = keep[j]
  }
  return out
}

const Lh = gaussBlur(Y, 1.1)
const seamC = centreLines(lineField(Lh, 1.1, true), 0.05, 0.02, 10)
const bevelC = centreLines(lineField(Lh, 1.1, false), 0.05, 0.02, 10)
const headLineV = new Float32Array(N)
for (let i = 0; i < N; i++) headLineV[i] = Math.max(smooth(0.02, 0.125, seamC[i]), 0.45 * smooth(0.02, 0.125, bevelC[i]))

/* ----------------------------------------------------------- the layers */

const CYAN = [0.1, 0.86, 1.0]
const ICE = [0.55, 0.95, 1.0]
const ORANGE = [1.0, 0.13, 0.1] // the red of Ultron's eyes (kept under its old name)
const HOT = [1.0, 0.58, 0.4]

const mk = () => new Float32Array(N * 3)
const paint = (buf, i, c, k) => {
  buf[i * 3] += c[0] * k
  buf[i * 3 + 1] += c[1] * k
  buf[i * 3 + 2] += c[2] * k
}

const linesB = mk()
const fillB = mk()
// The head is small on screen and carries the character, so it gets extra
// particles of its own: the same lines and shading, fading out below the jaw.
const HEAD_BOTTOM = 425 + OY
const headLinesB = mk()
const headFillB = mk()
const headW = (y) => smooth(HEAD_BOTTOM + 30, HEAD_BOTTOM - 30, y)
const rimB = mk()
const dustB = mk()
const veinsB = mk()
const redRimB = mk()
const lightsB = mk()

const spill = blur(red, 8)
const thick = blur(red, 1)

// THE EYES are drawn by the engine, so that they can move (meta.eyes): an iris of rings
// round a hot pupil, cut by an upper and a lower lid that are not drawn themselves (the user
// had their red edges taken out), only felt by what they hide. Read off v2 (render
// px): each iris is centred on its dark pupil, at (445.5, 201.5) and (581, 202), its red
// reaching 13.5 px out; the lids show it from 6.5 px above the centre to 9.5 px below (the
// upper one covers its top, which is what makes the stare cold). The socket is an almond
// slanting 8 degrees down toward the nose, its corners 34 px out toward the temple and 30 px
// in toward the nose. u runs along the eye toward its inner corner, v across it, downward.
const EYES = {
  slant: (8 * Math.PI) / 180,
  outer: 34,
  inner: 30,
  up: 6.5,
  lo: 9.5,
  iris: 13.5,
  rings: 2.5, // bright at the rim, every 1/rings of the radius inward, dark between
  at: [
    { c: [445.5, 201.5 + OY], side: 1 }, // the left eye (on screen); its inner corner is to the right
    { c: [581, 202 + OY], side: -1 },
  ],
}
const eyeUV = (x, y, { c, side }) => {
  const dx = x - c[0]
  const dy = y - c[1]
  const cs = Math.cos(EYES.slant)
  const sn = Math.sin(EYES.slant)
  return [dx * side * cs + dy * sn, -dx * side * sn + dy * cs]
}

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x
    const sf = sideFade[x]
    if (hull[i]) {
      paint(linesB, i, CYAN, lineV[i] * 1.15 * sf)
      paint(fillB, i, CYAN, fillV[i] * 0.62 * sf)
      if (y < HEAD_BOTTOM + 30) paint(headFillB, i, CYAN, fillV[i] * 0.62 * headW(y))
      const rimIn = Math.exp(-dIn[i] / 2.2)
      const spec = hlV[i] * smooth(0.35, 0.8, Ys[i])
      paint(rimB, i, ICE, (rimIn * 0.75 + spec * 0.9) * sf)

      const rv = Math.max(red[i], thick[i] * 1.3)
      const k = rv * (0.5 + 0.8 * R[i]) * sf
      paint(veinsB, i, ORANGE, k)
      paint(veinsB, i, HOT, k * red[i] * 0.35)
      const hot = red[i] * smooth(0.5, 0.85, R[i])
      paint(lightsB, i, ORANGE, hot * 1.1 * sf)
      paint(lightsB, i, HOT, hot * hot * 0.7 * sf)
    } else {
      const o = dOut[i]
      paint(rimB, i, ICE, Math.exp(-o / 6) * 0.32 * sf)
      const plume = 0.2 + fbm(x * 0.02, y * 0.02)
      paint(dustB, i, CYAN, Math.exp(-o / 20) * plume * 0.35 * smooth(1.5, 5, o) * sf)
    }
    const sp = clamp(spill[i] * 1.6 - red[i] * 0.6)
    paint(redRimB, i, ORANGE, sp * 0.9 * sf)
    // (the outline's own crease, just outside it, is a line too)
    if (y < HEAD_BOTTOM + 30) paint(headLinesB, i, CYAN, headLineV[i] * headW(y))
  }
}

// The render's irises come out of lights.png (the engine draws its own, see EYES), and with
// them the almond halo they used to have, which read as a white-hot smudge at this size.
for (const eye of EYES.at) {
  for (let y = Math.round(eye.c[1]) - 50; y <= Math.round(eye.c[1]) + 50; y++) {
    for (let x = Math.round(eye.c[0]) - 60; x <= Math.round(eye.c[0]) + 60; x++) {
      const [u, v] = eyeUV(x + 0.5, y + 0.5, eye)
      const keep = 1 - Math.exp(-2 * ((u / 40) ** 2 + (v / 18) ** 2))
      const i = (y * W + x) * 3
      for (let c = 0; c < 3; c++) lightsB[i + c] *= keep
    }
  }
}

/* -------------------------------------------------------------- the faces */

// Where the head sits in the render, measured off it (render px, +OY on the canvas).
const FACE = { cx: CX, cy: 255 + OY, sx: 105, sy: 125 }
const faceBlob = (x, y, k = 1) => {
  const dx = (x - FACE.cx) / (FACE.sx * k)
  const dy = (y - FACE.cy) / (FACE.sy * k)
  return Math.exp(-(dx * dx + dy * dy))
}

// THE MOUTH. The render has no lips: the mouth is the seam under the nose plate (render y
// 331.5, from x ~470 to ~554, with a little red vent at each end, x 458 and 566), and under it
// the jaw, a piece of its own: three rounded tabs hanging below the seam, the column between
// the two cheek pods (|dx| < 24 from the middle, down to their lower ends at y 400), and the
// chin cup with the emblem (|dx| < 82 below that, down to where the head ends). Speaking, the
// engine drops that piece by up to 6 px and lights the slit it opens (meta.mouth, canvas px).
const MOUTH = { seam: 331.5 + OY, x0: 458, x1: 566, column: 24, cupTop: 400 + OY, cup: 82, open: 6 }

/** A soft round dab. */
function dab(buf, x, y, c, k, rad) {
  const R2 = Math.ceil(rad * 2)
  for (let j = -R2; j <= R2; j++) {
    for (let q = -R2; q <= R2; q++) {
      const px = Math.floor(x) + q
      const py = Math.floor(y) + j
      if (px < 0 || py < 0 || px >= W || py >= H) continue
      const w = Math.exp(-((px + 0.5 - x) ** 2 + (py + 0.5 - y) ** 2) / (rad * rad))
      if (w >= 0.02) paint(buf, py * W + px, c, k * w)
    }
  }
}


/* ------------------------------------------------------------------ the chin */

// The tip of the chin is a round emblem (outline radii 18.5 x 16.5 around (511, 411) in
// the render), set in a cup of plate whose lower edge is flat under it (render y 431.5),
// rises on a diagonal to the corners about 80 px out (y 410) and on to the cheeks' lower
// edge (y ~395 from 100 px out), under which the tops of the neck cables tuck in: in all
// four renders (v1-v4) the cables pass behind the jaw. That edge is where the head ends
// (the engine's jawLine is the same curve + 1.5 px). The emblem's outline is in the
// extracted lines, but no denser than the cheeks around it, so it does not read as a ring;
// the edge is a crease in shadow that the extraction barely sees. Both are traced here
// into a layer of their own (chin.png) so that they can have a few more particles than
// the lines around them, but in the head's own material: its cyan, its particle size and
// grain, nothing whiter or heavier. (A white stroke with a shadow band under it was tried
// and read as a sticker on the face.) Geometry read off v2, the render this art is made from.
const CHIN = { cx: 511.2, cy: 411 + OY, rx: 18.6, ry: 16.2 }
const chinEdge = (dx) => 431.5 + OY - 22 * smooth(24, 80, Math.abs(dx)) - 16 * smooth(80, 100, Math.abs(dx))
const chinB = mk()
// Like the extracted lines, not a ruled curve: a stroke a few px wide, its weight broken up
// by grain and its course wandering by a px or so.
const grain = (x, y) => 0.5 + fbm(x * 0.16, y * 0.16)
const wander = (u, seed) => (fbm(u, seed) - 0.5) * 2.4
{
  const steps = Math.ceil(2 * Math.PI * Math.max(CHIN.rx, CHIN.ry) * 2)
  for (let n = 0; n < steps; n++) {
    const a = (n / steps) * Math.PI * 2
    const s = 1 + wander(a * 2.5, 7.7) / CHIN.rx
    const x = CHIN.cx + Math.cos(a) * CHIN.rx * s
    const y = CHIN.cy + Math.sin(a) * CHIN.ry * s
    dab(chinB, x, y, CYAN, 0.13 * grain(x, y), 1.5)
  }
}
for (let dx = -104; dx <= 104; dx += 0.5) {
  const x = CHIN.cx + dx
  const y = chinEdge(dx) + wander(dx * 0.09, 3.1)
  const end = 1 - smooth(88, 104, Math.abs(dx)) // it runs into the cheeks' own edges
  dab(chinB, x, y, CYAN, 0.13 * end * grain(x, y), 1.5)
}

/* --------------------------------------------------------------- the arteries */

// Four arteries carry the figure's energy from the chest up to the head, and the engine
// runs its effects along them (intensity, work, communication). It draws them as particles
// along these routes, so they are not painted here: only their course goes into meta.json.
// Agreed with the user on sketches over v2. Both pairs end at the eyes, a circuit round each:
// the inner ones from below, the outer ones from above. Two inner arteries go up the red
// strip in the gap between each neck cable and the plate, pass behind the plate's corner and
// the jaw, come out at the cheek's lower edge, pass the red core of the cheek socket and go
// on up the red strip of the cheekbone to just under the lower lid. Two outer ones run under
// the chest plates to the red cavity behind the collarbone, climb the cable's outer edge,
// pass behind the side of the head and come out at the red louvres of the temple; from there
// they climb inside the skull nearly to the top of the forehead, hook over, and come down
// the red seam of the forehead to just over the upper lid, at its outer half (they used to go
// on over the skull to the crown). The course reaches the eyes, but the pulses that run along
// it stop short of them except at the extremes (see the engine). They keep to red channels that are already in the render,
// and they cross from the neck into the head behind the jaw, like the cables, so a turn of
// the head hides the join.
// Where they start, two ways (the engine picks one, ?arteries=ports|core): 'ports', each
// side from the round red port on its own pectoral, or 'core', all four from one core under
// the sternum plate (the user tried the core and did not like it).
// Render px, left side; the right side is its mirror. [x, y, 1] = hidden behind a plate or
// the head: no particles there, but it counts toward the length, so whatever runs along an
// artery keeps time while it is out of sight.
// The last stretches, to the eyes, keep to the red channels exactly (measured on the render):
// the inner one from the cheek's core up the red strip of the cheekbone, (426, 245) to
// (400, 215), and into the corner of the socket; the outer one from the top of the temple's
// louvres up INSIDE the skull, behind its side (the skull's edge runs from x 366 at y 150 to
// 392 at y 90; going up outside it, the artery read as leaving the head), out at the top of
// the red seam of the forehead (394, 95), which starts right at that edge, and down it to the
// brow (414, 150), under the brow and out over the eye. Whatever lies under a plate is not
// drawn (see the engine's arteryParticles): they show only in the cavities and seams.
const NECK_TO_EYE = [
  [479, 610], [466, 576], [455, 542], [448, 512], [448, 492],
  [450, 466, 1], [452, 440, 1], [452, 418, 1],
  [450, 402], [446, 380], [438, 357], [431, 330], [431, 304],
  [430, 284], [428, 264], [426, 246], [419, 236], [413, 230], [409, 225], [405, 220], [401, 215],
  [404, 209], [409, 205],
]
const CAVITY_TO_EYE = [
  [352, 532], [346, 506], [358, 480], [377, 456], [386, 428], [388, 402],
  [386, 372, 1], [384, 336, 1], [383, 300, 1],
  [384, 286], [372, 256], [359, 219],
  [366, 200, 1], [371, 180, 1], [377, 158, 1], [383, 136, 1], [388, 117, 1], [392, 102, 1],
  [394, 95], [397, 105], [402, 120], [405, 130], [409, 140], [413, 150],
  [416, 160], [419, 171], [422, 180], [423, 186],
]
// On the left port's red rim (an arc from (432, 645) round to (472, 705)), at its upper
// right, so that the inner artery leaves the rim upward instead of crossing it.
const ARTERY_PORT = [454, 657]
const ARTERY_CORE = [512, 668]
const ARTERY_ORIGINS = {
  ports: {
    sources: [ARTERY_PORT],
    sourceSize: 0.7, // a smaller knot on the rim than the core's
    inner: [ARTERY_PORT, [466, 634], [477, 612], [468, 584], ...NECK_TO_EYE.slice(2)],
    outer: [[...ARTERY_PORT, 1], [425, 650, 1], [398, 610, 1], [372, 568, 1], ...CAVITY_TO_EYE],
  },
  core: {
    sources: [ARTERY_CORE],
    shared: true, // one source in the middle for both sides
    inner: [ARTERY_CORE, [510, 645], [503, 627], [492, 616], ...NECK_TO_EYE],
    outer: [[...ARTERY_CORE, 1], [480, 655, 1], [440, 632, 1], [405, 604, 1], [374, 568, 1], ...CAVITY_TO_EYE],
  },
}
const mirrorX = (x, side) => (side < 0 ? x : 1023 - x)
const toCanvas = (pts, side) => pts.map(([x, y, h]) => [mirrorX(x, side), y + OY, h ? 1 : 0])
const arteries = Object.fromEntries(
  Object.entries(ARTERY_ORIGINS).map(([name, o]) => [
    name,
    {
      sources: (o.shared ? [-1] : [-1, 1]).flatMap((side) => o.sources.map(([x, y]) => [mirrorX(x, side), y + OY])),
      sourceSize: o.sourceSize ?? 1,
      routes: [-1, 1].flatMap((side) => [
        { role: 'inner', side, pts: toCanvas(o.inner, side) },
        { role: 'outer', side, pts: toCanvas(o.outer, side) },
      ]),
    },
  ]),
)

// THE PLATES IN FRONT of the arteries (plates.png, grey). The arteries run UNDER the metal
// (user: they should be "ofuscadas pelas placas", respecting the plates' depth): seen in the
// seams, the gaps, the dark cavities and the red channels, hidden where a plate lies over
// them, and only the harder they work does their light get through. 1 = a plate in front,
// 0 = open. Read off the render: lit metal is a plate; a seam is darker than what is round
// it; a cavity is dark; a channel glows red. Softened by a px or two, because the routes
// were laid by hand and a narrow channel should not shut on them for a pixel's error.
const plates = new Float32Array(N)
{
  const redWide = blur(red, 1.5)
  for (let i = 0; i < N; i++) {
    if (!hull[i]) continue
    const lit = smooth(0.08, 0.3, Ys[i])
    const seam = smooth(0.02, 0.12, B3[i] - Y[i])
    const channel = smooth(0.08, 0.35, Math.max(red[i], redWide[i] * 1.6))
    plates[i] = lit * (1 - seam) * (1 - channel)
  }
  plates.set(blur(plates, 1.2))
}

function faceLayer(state) {
  const f = mk()
  const cfg = {
    idle: { size: 1, power: 1 },
    listening: { size: 0.7, power: 0.55 },
    thinking: { size: 0.78, power: 1.05 },
    tooling: { size: 0.9, power: 1.1 },
  }[state]

  for (let y = 0; y < HEAD_BOTTOM; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (!hull[i]) continue
      const b = faceBlob(x, y, cfg.size)
      if (b < 0.01) continue
      // Lines carry most of the light, a faint wash of the plates fills between
      // them, and the dark seams and sockets burn: that is where the machine shows.
      const dark = smooth(0.1, 0.03, Y[i])
      const wash = lineV[i] * 0.45 + fillV[i] * 0.05 + dark * 1.0
      paint(f, i, ORANGE, wash * b * cfg.power)
      paint(f, i, HOT, dark * b * b * cfg.power * 0.25)
    }
  }

  // (Listening had waves arriving at the horns, thinking a spiral drawing in between the
  // eyes, tooling dashed rings in the cheek sockets and a dotted read-out down the nose; the
  // user had them all removed. The voice it hears now comes in down the arteries, the
  // thought goes up them to the crown, and work beats through them: see the engine. Speaking
  // had a voice-print of bars across the lower face; the mouth speaks now, see MOUTH.)
  return f
}

/* --------------------------------------------------------------- outputs */

// Soft shoulder, as in generate.mjs: bright things roll off to white.
function out(name, buf) {
  const o = new Float32Array(N * 3)
  for (let i = 0; i < N * 3; i++) o[i] = Math.pow(1 - Math.exp(-1.7 * Math.max(0, buf[i])), 0.95)
  writePng(path.join(OUT, name), o, W, H)
  console.log('wrote', name)
}

const STATES = ['idle', 'listening', 'thinking', 'tooling']
const structure = mk()
for (let i = 0; i < N * 3; i++)
  structure[i] = linesB[i] + fillB[i] + rimB[i] + dustB[i] + redRimB[i] + lightsB[i] + chinB[i]

out('lines.png', linesB)
out('fill.png', fillB)
// linear: a seam at full weight is a full-weight line, a bevel under half that
writePng(path.join(OUT, 'head-lines.png'), headLinesB.map((v) => clamp(v)), W, H)
console.log('wrote head-lines.png')
out('head-fill.png', headFillB)
out('rim.png', rimB)
out('dust.png', dustB)
out('veins.png', veinsB)
out('redrim.png', redRimB)
out('lights.png', lightsB)
out('chin.png', chinB)
{
  // linear, not through the shoulder of out(): the engine reads it as a number
  const g = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) g[i * 3] = g[i * 3 + 1] = g[i * 3 + 2] = clamp(plates[i])
  writePng(path.join(OUT, 'plates.png'), g, W, H)
  console.log('wrote plates.png')
}

for (const s of STATES) {
  const face = faceLayer(s)
  out(`face-${s}.png`, face)
  const comp = mk()
  for (let i = 0; i < N; i++) {
    const x = i % W
    const y = (i / W) | 0
    // Under the red glow the cyan lines give way to it.
    const dim = y < HEAD_BOTTOM ? 1 - 0.4 * clamp(faceBlob(x, y, 1.05)) : 1
    for (let c = 0; c < 3; c++) comp[i * 3 + c] = structure[i * 3 + c] * dim + veinsB[i * 3 + c] * 0.9 + face[i * 3 + c]
  }
  out(`preview-${s}.png`, comp)
}

fs.copyFileSync(path.join(here, '..', 'img', 'backdrop.png'), path.join(OUT, 'backdrop.png'))
const old = JSON.parse(fs.readFileSync(path.join(here, '..', 'img', 'meta.json'), 'utf8'))
fs.writeFileSync(
  path.join(OUT, 'meta.json'),
  JSON.stringify(
    {
      W,
      H,
      BW: old.BW,
      BH: old.BH,
      face: FACE,
      states: STATES,
      fill: true,
      head: true,
      chin: true, // the emblem's outline and the edge where the head ends (see the chin section)
      arteries, // the course of the four arteries for each choice of origin, canvas px (see the arteries section)
      eyes: EYES, // the eyes the engine draws: their geometry, canvas px (see the eyes section)
      mouth: MOUTH, // the slit under the nose plate and the jaw piece under it, canvas px (see the mouth section)
      dimScale: 0.5, // the cyan of the head gives way to the red glow only half as far
      budget: {
        lines: 21000,
        fill: 15000,
        headLines: 10000,
        chin: 900,
        arteries: 5000,
        headFill: 5000,
        rim: 15000,
        dust: 3000,
        redrim: 4000,
        lights: 4200,
        veins: 8000,
        face: 4500,
        eyes: 1700,
        mouth: 500,
        backdrop: 15000,
      },
      source: path.relative(path.join(here, '..', '..'), SRC).replaceAll('\\', '/'),
    },
    null,
    2,
  ),
)
console.log('wrote meta.json')
