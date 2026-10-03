// Procedural source art for the particle humanoid prototype.
//
//   node proto/art/generate.mjs
//
// Writes PNGs into proto/img/. The particle engine (proto/main.js) only ever
// reads those PNGs, so any of them can be replaced by hand-made or AI-made art
// of the same size without touching the engine.
//
//   lines.png       cyan: the contour lines and facet edges
//   rim.png         cyan: the rim light and the halo outside it
//   dust.png        cyan: the dust shed by the figure
//   structure.png   all three together (what the preview composites)
//   veins.png       orange only: the branching circuitry on the neck and chest
//   face-*.png      orange only: what the face does in each state
//   preview-*.png   all of the above composited, for eyeballing
//   backdrop.png    the two energy ridges either side of the figure
//   meta.json       sizes and the face zone, shared with the engine
//
// No dependencies: PNGs are encoded by hand with node:zlib.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'img')
fs.mkdirSync(OUT, { recursive: true })

const W = 1024
const H = 1100
const CX = 512
const N = W * H

/* ---------------------------------------------------------------- helpers */

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = rng(20260401)

const lerp = (a, b, t) => a + (b - a) * t
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
  return lerp(
    lerp(hash2(ix, iy), hash2(ix + 1, iy), u),
    lerp(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), u),
    v,
  )
}
function fbm(x, y, oct = 4) {
  let s = 0
  let a = 0.5
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x, y)
    x *= 2.03
    y *= 2.03
    a *= 0.5
  }
  return s
}

/* ------------------------------------------------------------- PNG output */

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
/** rgb: Float32Array(w*h*3) linear 0..inf — tone-mapped here. */
function writePng(name, rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      const o = y * (w * 3 + 1) + 1 + x * 3
      for (let c = 0; c < 3; c++) {
        // Soft shoulder: bright things roll off to white instead of clipping flat.
        const v = 1 - Math.exp(-1.7 * Math.max(0, rgb[i + c]))
        raw[o + c] = Math.round(255 * Math.pow(v, 0.95))
      }
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
  fs.writeFileSync(path.join(OUT, name), png)
  console.log('wrote', name, (png.length / 1024).toFixed(0) + ' KB')
}

/* ------------------------------------------------------------- silhouette */

/** Catmull-Rom through pts; first/last act as tangent guides only. */
function catmull(pts, per = 10) {
  const out = []
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2]
    for (let s = 0; s < per; s++) {
      const t = s / per
      const t2 = t * t
      const t3 = t2 * t
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ])
    }
  }
  out.push(pts[pts.length - 2])
  return out
}

// Half profiles are (dx from centre, y), drawn from the film references: a
// long narrow skull with a brow ridge that juts out over the face, a heavy lower
// face that tapers to a small chin plate, two crescent horns hooking off the
// temples, a short segmented neck, and — the part that says "Ultron" from across
// a room — enormous rounded pauldrons that rise higher than the base of the neck
// and leave a deep V around it.
const skull = [
  [0, 92], // crest
  [28, 95],
  [60, 108],
  [92, 140],
  [116, 188],
  [128, 244],
  [134, 300],
  [140, 346],
  [150, 376], // brow ridge, jutting
  [138, 404],
]
const headHalf = [
  ...skull,
  [142, 450],
  [152, 500], // cheek, where the mask plates sit
  [146, 556],
  [118, 606],
  [74, 644],
  [32, 664],
  [0, 672], // chin
]
// The horns are their own thin crescents so they read as separate hooks rather
// than as a flare of the skull.
const hornHalf = [
  [112, 268], [152, 240], [200, 256], [230, 310], [232, 380], [216, 444], [188, 490],
  [176, 478], [196, 430], [206, 378], [204, 324], [182, 286], [152, 270], [124, 284],
]
const bodyHalf = [
  [0, 640],
  [96, 640],
  [100, 700], // neck: a thick column
  [106, 762],
  [150, 766], // the floor of the V
  [210, 744],
  [280, 712],
  [340, 690], // pauldron crown
  [408, 712],
  [466, 770],
  [498, 860],
  [508, 980],
  [510, H + 4],
  [0, H + 4],
]

function mirror(half) {
  const right = half.map(([dx, y]) => [CX + dx, y])
  const left = half.map(([dx, y]) => [CX - dx, y]).reverse()
  return [...right, ...left]
}

function fillPoly(poly) {
  const m = new Uint8Array(N)
  for (let y = 0; y < H; y++) {
    const xs = []
    const yy = y + 0.5
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i]
      const [x1, y1] = poly[(i + 1) % poly.length]
      if ((y0 <= yy && y1 > yy) || (y1 <= yy && y0 > yy)) {
        xs.push(x0 + ((yy - y0) / (y1 - y0)) * (x1 - x0))
      }
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.round(xs[k]))
      const b = Math.min(W - 1, Math.round(xs[k + 1]))
      for (let x = a; x < b; x++) m[y * W + x] = 1
    }
  }
  return m
}

// The silhouettes above are now only a hull: the envelope the plates have to
// sit inside, used to decide where a gap between plates counts as a cavity
// (and so glows) rather than as open air.
const hullHead = fillPoly(mirror(headHalf))
for (const side of [-1, 1]) {
  const horn = fillPoly(hornHalf.map(([dx, y]) => [CX + side * dx, y]))
  for (let i = 0; i < N; i++) hullHead[i] |= horn[i]
}
const hullBody = fillPoly(mirror(bodyHalf))
const hull = new Uint8Array(N)
for (let i = 0; i < N; i++) hull[i] = hullHead[i] | hullBody[i]

/* ------------------------------------------------------------------ plates */

// The figure is armour, not skin: a set of separate plates, painted back to
// front into a label map. Where two plates meet a seam is carved out, so every
// plate gets its own rim light and the seams become glowing cavities.
//
//   kind 'edge'  hatch lines run concentric to the plate's outline
//   kind 'lin'   brushed-metal hatching at `angle` degrees
//   kind 'rad'   rings around (cx, cy), for discs and sockets
const plates = []
const label = new Int16Array(N)
function addPlate(poly, o = {}) {
  const id = plates.length + 1
  plates.push({ head: false, kind: 'edge', pitch: 5.5, angle: 0, bevel: false, lit: 0.62 + 0.38 * hash2(id * 17, id * 5), ...o })
  const m = fillPoly(poly)
  for (let i = 0; i < N; i++) if (m[i]) label[i] = id
  return id
}
const right = (half) => half.map(([dx, y]) => [CX + dx, y])
const left = (half) => half.map(([dx, y]) => [CX - dx, y])
const pair = (half, o) => {
  addPlate(right(half), o)
  addPlate(left(half), o)
}
const circle = (cx, cy, r, n = 32) =>
  Array.from({ length: n }, (_, k) => [cx + Math.cos((k / n) * 6.2832) * r, cy + Math.sin((k / n) * 6.2832) * r])
const grow = (poly, cx, cy, k) => poly.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k])

/** Punch a hole: nothing there, so whatever glows behind it shows. */
function hole(cx, cy, r) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (x >= 0 && y >= 0 && x < W && y < H && (x - cx) ** 2 + (y - cy) ** 2 <= r * r) label[y * W + x] = 0
    }
  }
}

/** A curved strip along a centreline, tapering from w0 to w1: the long tendon-like bands. */
function band(center, w0, w1) {
  const pts = [center[0], ...center, center[center.length - 1]]
  const c = catmull(pts, 10)
  const L = []
  const R = []
  for (let i = 0; i < c.length; i++) {
    const a = c[Math.max(0, i - 1)]
    const b = c[Math.min(c.length - 1, i + 1)]
    const tx = b[0] - a[0]
    const ty = b[1] - a[1]
    const len = Math.hypot(tx, ty) || 1
    const w = lerp(w0, w1, i / (c.length - 1)) / 2
    L.push([c[i][0] - (ty / len) * w, c[i][1] + (tx / len) * w])
    R.push([c[i][0] + (ty / len) * w, c[i][1] - (tx / len) * w])
  }
  return [...L, ...R.reverse()]
}
const bandPair = (half, w0, w1, o) => {
  addPlate(band(right(half), w0, w1), o)
  addPlate(band(left(half), w0, w1), o)
}

// Pauldrons: the big rounded shoulder armour, as nested layers that step
// inward like the overlapping shells in the film. Each carries a circular
// joint with a dark socket at its centre.
const pauldron = [[300, 752], [330, 716], [372, 700], [418, 716], [466, 770], [498, 860], [508, 980], [512, 1110], [340, 1110], [304, 1000], [296, 860]]
for (const side of [-1, 1]) {
  const base = side === 1 ? right(pauldron) : left(pauldron)
  const cx = CX + side * 420
  const cy = 940
  addPlate(base, { kind: 'edge', pitch: 7, bevel: true })
  addPlate(grow(base, cx, cy, 0.86), { kind: 'edge', pitch: 6.5, bevel: true })
  addPlate(grow(base, cx, cy, 0.7), { kind: 'edge', pitch: 6 })
  const jx = CX + side * 410
  for (const [r, pitch] of [[52, 4.6], [40, 4], [28, 3.4], [16, 3]]) addPlate(circle(jx, 872, r), { kind: 'rad', cx: jx, cy: 872, pitch })
  hole(jx, 872, 7)
}

// Collar, pectorals, the long bands that sweep across the chest, abdomen.
pair([[108, 778], [168, 770], [250, 760], [292, 780], [250, 802], [108, 810]], { kind: 'lin', angle: -8, pitch: 5 })
pair([[24, 810], [160, 800], [250, 818], [272, 900], [252, 986], [170, 1020], [24, 1002]], { kind: 'lin', angle: -34, pitch: 5.4, bevel: true })
bandPair([[118, 792], [190, 850], [232, 940], [238, 1040], [228, 1112]], 22, 16, { kind: 'lin', angle: -58, pitch: 4.4 })
bandPair([[170, 782], [250, 838], [286, 940], [292, 1050]], 17, 13, { kind: 'lin', angle: -70, pitch: 4 })
pair([[24, 1030], [168, 1030], [210, 1050], [200, 1078], [24, 1080]], { kind: 'lin', angle: 0, pitch: 5 })
pair([[24, 1090], [190, 1086], [186, 1112], [24, 1112]], { kind: 'lin', angle: 0, pitch: 5 })

// Sternum: a ladder — two rails with rungs between them.
for (const side of [-1, 1]) addPlate([[CX + side * 8, 792], [CX + side * 18, 792], [CX + side * 20, 1112], [CX + side * 8, 1112]], { kind: 'lin', angle: 0, pitch: 3.6 })
for (let y = 804; y < 1100; y += 38) addPlate([[CX - 6, y], [CX + 6, y], [CX + 6, y + 16], [CX - 6, y + 16]], { kind: 'lin', angle: 0, pitch: 3 })

// Neck: a thick column of segmented rings, cables running down it, and a
// heavier cable on either flank.
for (const [y0, y1, w] of [[690, 718, 88], [726, 754, 94], [762, 790, 98]]) {
  pair([[16, y0], [w, y0 + 4], [w, y1], [16, y1 + 4]], { kind: 'lin', angle: 0, pitch: 3.8, bevel: true })
}
addPlate([[CX - 12, 688], [CX + 12, 688], [CX + 12, 792], [CX - 12, 792]], { kind: 'lin', angle: 90, pitch: 3.4 }) // the central cable
for (const side of [-1, 1]) {
  addPlate([[CX + side * 104, 692], [CX + side * 118, 692], [CX + side * 124, 792], [CX + side * 108, 792]], { kind: 'edge', pitch: 3.6 })
}

// Head, back to front.
const H_ = { head: true }
// The cranium, split by a seam down the crest.
pair([[7, 94], [40, 98], [84, 128], [112, 176], [126, 236], [130, 296], [7, 298]], { ...H_, kind: 'edge', pitch: 6, bevel: true })
// Brow plates, slanted down toward the nose; the slot under them is the eye.
pair([[18, 306], [132, 300], [154, 346], [152, 378], [110, 386], [60, 394], [18, 410]], { ...H_, kind: 'lin', angle: -14, pitch: 4.6, bevel: true })
// Upper cheek, slanted to match.
pair([[18, 442], [60, 432], [112, 426], [148, 438], [150, 492], [18, 500]], { ...H_, kind: 'lin', angle: 10, pitch: 4.6 })
// Lower face: the jaw plates framing the mouth.
pair([[120, 576], [148, 552], [142, 604], [114, 648], [68, 674], [46, 674], [72, 640], [106, 606]], { ...H_, kind: 'lin', angle: 0, pitch: 4.2 })
// The nose: a ridge down the middle of the face.
addPlate([[CX - 13, 300], [CX + 13, 300], [CX + 17, 520], [CX - 17, 520]], { ...H_, kind: 'lin', angle: 90, pitch: 3.6, bevel: true })
// The mouth: a curved band under the nose, and a plate with a round hole at the chin.
addPlate([[CX - 74, 600], [CX - 28, 604], [CX + 28, 604], [CX + 74, 600], [CX + 64, 620], [CX + 28, 626], [CX - 28, 626], [CX - 64, 620]], { ...H_, kind: 'lin', angle: 0, pitch: 3.6 })
addPlate([[CX - 48, 634], [CX + 48, 634], [CX + 34, 670], [CX - 34, 670]], { ...H_, kind: 'lin', angle: 0, pitch: 3.6 })
for (const side of [-1, 1]) {
  // The big cheek cavities: plate inside plate, each ring its own seam, down
  // to a dark socket at the centre.
  const cx = CX + side * 100
  for (const [r, pitch] of [[52, 4.4], [41, 4], [30, 3.6]]) addPlate(circle(cx, 548, r), { ...H_, kind: 'rad', cx, cy: 548, pitch })
  hole(cx, 548, 19)
}
hole(CX, 652, 8)
// The horns, in three segments each.
{
  const outer = hornHalf.slice(0, 7)
  const inner = hornHalf.slice(7).reverse()
  for (const side of [-1, 1]) {
    for (const [a, b] of [[0, 2], [2, 4], [4, 6]]) {
      const o = outer.slice(a, b + 1)
      const n = inner.slice(a, b + 1).reverse()
      addPlate([...o, ...n].map(([dx, y]) => [CX + side * dx, y]), { ...H_, kind: 'edge', pitch: 4 })
    }
  }
}

// Straight cuts through the plates, so the armour is not a stack of tidy
// shapes: a panel line, a split, a vent. Applied before the seams are carved.
function cut(pts, w = 1.6) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[i + 1]
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0))
    for (let t = 0; t <= n; t++) {
      const x = x0 + ((x1 - x0) * t) / n
      const y = y0 + ((y1 - y0) * t) / n
      for (let dy = -Math.ceil(w); dy <= Math.ceil(w); dy++) {
        for (let dx = -Math.ceil(w); dx <= Math.ceil(w); dx++) {
          if (dx * dx + dy * dy > w * w) continue
          const px = Math.round(x + dx)
          const py = Math.round(y + dy)
          if (px >= 0 && py >= 0 && px < W && py < H) label[py * W + px] = 0
        }
      }
    }
  }
}
// The creases scored across the forehead glow red; the paths are shared with
// the light layer below.
const CREASES = [
  [[16, 238], [54, 266], [112, 242]],
  [[30, 186], [68, 206], [104, 190]],
]
for (const side of [-1, 1]) {
  const X = (dx) => CX + side * dx
  cut([[X(400), 1100], [X(450), 1020], [X(486), 1000]], 1.4)
  cut([[X(150), 900], [X(200), 896]], 2.4)
  cut([[X(150), 928], [X(200), 924]], 2.4)
  for (const path of CREASES) cut(path.map(([dx, y]) => [X(dx), y]), 1.5)
  cut([[X(60), 560], [X(96), 640]], 1.2)
}

// Carve the seams: any pixel touching a different plate is removed.
{
  const out = []
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x
      const id = label[i]
      if (!id) continue
      let hit = false
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const n = label[i + dy * W + dx]
          if (n && n !== id) {
            hit = true
            break
          }
        }
      }
      if (hit) out.push(i)
    }
  }
  for (const i of out) label[i] = 0
}

const maskHead = new Uint8Array(N)
const maskAll = new Uint8Array(N)
const plateCx = new Float32Array(plates.length + 1)
const plateCy = new Float32Array(plates.length + 1)
const plateR = new Float32Array(plates.length + 1)
{
  const cnt = new Float32Array(plates.length + 1)
  for (let i = 0; i < N; i++) {
    const id = label[i]
    if (!id) continue
    maskAll[i] = 1
    if (plates[id - 1].head) maskHead[i] = 1
    cnt[id]++
    plateCx[id] += i % W
    plateCy[id] += (i / W) | 0
  }
  for (let id = 1; id <= plates.length; id++) {
    plateCx[id] /= Math.max(cnt[id], 1)
    plateCy[id] /= Math.max(cnt[id], 1)
    plateR[id] = Math.sqrt(Math.max(cnt[id], 1) / Math.PI)
  }
}

/** 3-4 chamfer distance, in px, from every `src===1` pixel to the nearest 0. */
function distance(src) {
  const d = new Float32Array(N)
  for (let i = 0; i < N; i++) d[i] = src[i] ? 1e9 : 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (d[i] === 0) continue
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
      if (d[i] === 0) continue
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
  for (let i = 0; i < N; i++) d[i] /= 3
  return d
}
const dinAll = distance(maskAll)
const outMask = new Uint8Array(N)
for (let i = 0; i < N; i++) outMask[i] = maskAll[i] ? 0 : 1
const dout = distance(outMask)

/* ------------------------------------------------------------ the layers */

// Where the orange lives: the blank face. The engine reads these numbers from
// meta.json so its dimming of the cyan under the glow matches this art.
const FACE = { cx: CX, cy: 436, sx: 98, sy: 118 }
const faceBlob = (x, y, k = 1) => {
  const dx = (x - FACE.cx) / (FACE.sx * k)
  const dy = (y - FACE.cy) / (FACE.sy * k)
  return Math.exp(-(dx * dx + dy * dy))
}

const CYAN = [0.1, 0.86, 1.0]
const ORANGE = [1.0, 0.13, 0.1] // the red of Ultron's eyes (kept under its old name)
const HOT = [1.0, 0.58, 0.4]

const linesB = new Float32Array(N * 3)
const rimB = new Float32Array(N * 3)
const dustB = new Float32Array(N * 3)
const structure = new Float32Array(N * 3)
const lineFace = new Float32Array(N) // the head's contour lines, reused as the orange carrier

function add(buf, x, y, c, k) {
  const i = (y * W + x) * 3
  buf[i] += c[0] * k
  buf[i + 1] += c[1] * k
  buf[i + 2] += c[2] * k
}
/** A soft round dab. */
function splat(buf, x, y, c, k, r = 1.1) {
  const R = Math.ceil(r * 2)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  for (let j = -R; j <= R; j++) {
    for (let i = -R; i <= R; i++) {
      const px = x0 + i
      const py = y0 + j
      if (px < 0 || py < 0 || px >= W || py >= H) continue
      const dx = px + 0.5 - x
      const dy = py + 0.5 - y
      const w = Math.exp(-(dx * dx + dy * dy) / (r * r))
      if (w < 0.02) continue
      add(buf, px, py, c, k * w)
    }
  }
}

/** Thin line from phase: 1 on the line, 0 between. */
function thin(phase, w) {
  const f = phase - Math.floor(phase) - 0.5
  return Math.exp(-(f * f) / (w * w))
}

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x
    let rgb = 0
    let line = 0
    if (maskAll[i]) {
      const din = dinAll[i]
      const inHead = maskHead[i] === 1
      const id = label[i]
      const pl = plates[id - 1]

      // Brushed-metal hatching, laid out per plate.
      let phase
      if (pl.kind === 'lin') {
        const a = (pl.angle * Math.PI) / 180
        phase = (x * Math.sin(a) + y * Math.cos(a)) / pl.pitch
      } else if (pl.kind === 'rad') {
        phase = Math.hypot(x - pl.cx, y - pl.cy) / pl.pitch
      } else {
        phase = din / pl.pitch
      }
      line = thin(phase, 0.1)

      // Broken into dashes so it dissolves into dots rather than reading as a
      // drawn stroke — and so there is variation for the sampler to pick from.
      const dash = fbm(x * 0.21, y * 0.21, 2)
      line *= 0.35 + 0.9 * smooth(0.36, 0.58, dash)
      if (inHead) lineFace[i] = line

      // Each plate is lit from the upper left, and has its own sheen.
      const nx = (x - plateCx[id]) / plateR[id]
      const ny = (y - plateCy[id]) / plateR[id]
      const light = clamp(0.5 - 0.5 * (nx * 0.55 + ny * 0.7))
      const lit = pl.lit * (0.62 + 0.75 * light)
      // A bevel: a second bright line a little inside the edge.
      const bevel = pl.bevel ? Math.exp(-((din - 9) * (din - 9)) / 5) * 0.55 : 0

      const rim = Math.exp(-din / 5.5)
      const rimWide = Math.exp(-din / 24)
      const fade = smooth(0, 70, 1100 - y) * 0.4 + 0.6 // the chest recedes toward the bottom edge
      const kl = (line * (0.42 + 0.25 * rimWide) + bevel * 0.5) * lit * fade
      const kr = rim * 0.7 + rimWide * 0.07
      const white = clamp(rim * 0.55)
      linesB[i * 3] = CYAN[0] * kl
      linesB[i * 3 + 1] = CYAN[1] * kl
      linesB[i * 3 + 2] = CYAN[2] * kl
      rimB[i * 3] = lerp(CYAN[0], 0.8, white) * kr
      rimB[i * 3 + 1] = lerp(CYAN[1], 0.97, white) * kr
      rimB[i * 3 + 2] = lerp(CYAN[2], 1.0, white) * kr
      rgb = 1
    } else {
      const d = dout[i]
      const k = Math.exp(-d / 6.5) * 0.4 + Math.exp(-d / 30) * 0.06
      if (k > 0.004 && rgb === 0) {
        rimB[i * 3] = CYAN[0] * k
        rimB[i * 3 + 1] = CYAN[1] * k
        rimB[i * 3 + 2] = CYAN[2] * k
      }
    }
  }
}

// Dust shed by the figure. Outside the silhouette, thinning with distance, with
// a plume rising off the crown — it is what makes the edge look like it is
// slowly coming apart rather than being a clean cut-out.
for (let n = 0, placed = 0; placed < 10500 && n < 600000; n++) {
  const x = rand() * W
  const y = rand() * H
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const d = dout[yi * W + xi]
  if (maskAll[yi * W + xi] || d > 150) continue
  const plume = Math.exp(-(((x - CX) / 90) ** 2)) * smooth(300, 40, y) * 0.6
  const p = (Math.exp(-d / 30) * 0.38 + plume) * (hull[yi * W + xi] ? 0.15 : 1)
  if (rand() > p) continue
  placed++
  splat(dustB, x, y, CYAN, 0.35 + rand() * 0.9, 0.7 + rand() * 0.5)
}
// A few dots drifting inside too, so the body is not perfectly clean.
for (let n = 0, placed = 0; placed < 5000 && n < 200000; n++) {
  const x = rand() * W
  const y = rand() * H
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  if (!maskAll[yi * W + xi]) continue
  const p = Math.exp(-dinAll[yi * W + xi] / 40)
  if (rand() > p) continue
  placed++
  splat(dustB, x, y, CYAN, 0.3 + rand() * 0.6, 0.6)
}

/* ------------------------------------------------- red rim light + streak */

// The red lighting the reference illustration puts around the whole figure,
// and the hard horizontal flare that cuts across it at eye level.
const lightsB = new Float32Array(N * 3)
const redRimB = new Float32Array(N * 3)
const streakB = new Float32Array(N * 3)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x
    if (maskAll[i]) continue
    const d = dout[i]
    const kk = (Math.exp(-d / 9) * 0.32 + Math.exp(-d / 40) * 0.08) * (0.45 + 0.55 * smooth(150, 800, y)) * (hull[i] ? 1.3 + 0.9 * smooth(820, 1100, y) : 1)
    if (kk > 0.004) {
      redRimB[i * 3] = ORANGE[0] * kk
      redRimB[i * 3 + 1] = ORANGE[1] * kk
      redRimB[i * 3 + 2] = ORANGE[2] * kk
    }
    const sy = y - 394
    const edge = smooth(0, 90, x) * smooth(0, 90, W - x)
    const band = Math.exp(-(sy * sy) / (2 * 2.4 * 2.4)) * 0.85 + Math.exp(-(sy * sy) / (2 * 22 * 22)) * 0.12
    const ks = band * edge * (0.45 + 0.55 * smooth(0.28, 0.55, fbm(x * 0.03, 7, 3)))
    if (ks > 0.01) {
      streakB[i * 3] = ORANGE[0] * ks
      streakB[i * 3 + 1] = ORANGE[1] * ks + HOT[1] * 0.08 * band
      streakB[i * 3 + 2] = ORANGE[2] * ks + HOT[2] * 0.06 * band
    }
  }
}

/* ---------------------------------------------------------------- veins */

const veins = new Float32Array(N * 3)
function vein(x, y, ang, len, power, depth) {
  let px = x
  let py = y
  let a = ang
  for (let s = 0; s < len; s++) {
    a += (rand() - 0.5) * 0.22
    // Pulled back toward the spine so the tree keeps a trunk.
    a += (-Math.PI / 2 - a) * 0.012
    px += Math.cos(a) * 1.5
    py += Math.sin(a) * 1.5
    const xi = Math.round(px)
    const yi = Math.round(py)
    if (xi < 0 || xi >= W || yi < 0 || yi >= H) return
    if (!hull[yi * W + xi] || py < 690) return
    const k = power * (1 - (s / len) * 0.55)
    splat(veins, px, py, ORANGE, k * 0.9, 0.85)
    if (k > 0.5) splat(veins, px, py, HOT, k * 0.12, 0.8)
    if (depth < 4 && rand() < 0.011 * (1 - s / len)) {
      const side = rand() < 0.5 ? -1 : 1
      vein(px, py, a + side * (0.4 + rand() * 0.55), len * (0.5 + rand() * 0.25), power * 0.75, depth + 1)
    }
  }
}
vein(CX, H, -Math.PI / 2, 440, 1.0, 0)
for (let k = 0; k < 3; k++) {
  vein(CX + (rand() - 0.5) * 24, H, -Math.PI / 2 + (rand() - 0.5) * 0.35, 330 + rand() * 80, 0.85, 1)
}
for (const side of [-1, 1]) {
  vein(CX + side * 8, 960, -Math.PI / 2 + side * 0.95, 190, 0.7, 2)
  vein(CX + side * 10, 900, -Math.PI / 2 + side * 0.55, 150, 0.7, 2)
}

/* -------------------------------------------------------------- the lights */

// The small hard lights: eyes in slanted sockets, the targets at the centre of
// the cheek cavities, the chin hole, the shoulder joints, and the creases scored
// across the forehead. They are their own layer so the engine can drive them by
// state — brighter when listening, flickering while thinking.
for (const side of [-1, 1]) {
  const ex = CX + side * 68
  const ey = 412
  const slant = side * (14 * Math.PI) / 180 // the inner end sits lower
  const ux = Math.cos(slant)
  const uy = Math.sin(slant)
  for (let y = ey - 60; y <= ey + 60; y++) {
    for (let x = ex - 80; x <= ex + 80; x++) {
      const dx = x - ex
      const dy = y - ey
      const u = dx * ux + dy * uy
      const v = -dx * uy + dy * ux
      const core = Math.exp(-((u * u) / (2 * 21 * 21) + (v * v) / (2 * 5.6 * 5.6)))
      const halo = Math.exp(-((u * u) / (2 * 40 * 40) + (v * v) / (2 * 17 * 17)))
      const i = y * W + x
      lightsB[i * 3] += ORANGE[0] * (halo * 0.5 + core * 0.9) + HOT[0] * core * 0.7
      lightsB[i * 3 + 1] += ORANGE[1] * halo * 0.45 + HOT[1] * core * 1.8
      lightsB[i * 3 + 2] += ORANGE[2] * halo * 0.45 + HOT[2] * core * 1.5
    }
  }
  for (const [cx, cy, r, k] of [
    [CX + side * 100, 548, 5, 0.9], // the target in each cheek cavity
    [CX + side * 410, 872, 6, 0.9], // shoulder joint cores
  ]) splat(lightsB, cx, cy, ORANGE, k, r)
  for (const path of CREASES) {
    for (let i = 0; i + 1 < path.length; i++) {
      const [x0, y0] = path[i]
      const [x1, y1] = path[i + 1]
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0))
      for (let t = 0; t <= n; t++) splat(lightsB, CX + side * (x0 + ((x1 - x0) * t) / n), y0 + ((y1 - y0) * t) / n, ORANGE, 0.55, 1.5)
    }
  }
}
splat(lightsB, CX, 652, ORANGE, 1.0, 6) // the chin hole

/* -------------------------------------------------------------- the faces */

function faceLayer(state) {
  const f = new Float32Array(N * 3)
  const set = (i, c, k) => {
    f[i * 3] += c[0] * k
    f[i * 3 + 1] += c[1] * k
    f[i * 3 + 2] += c[2] * k
  }
  const cfg = {
    idle: { size: 1, power: 1 },
    listening: { size: 0.7, power: 0.55 },
    thinking: { size: 0.78, power: 1.05 },
    speaking: { size: 0.95, power: 1.1 },
    strong: { size: 1.15, power: 1.35 },
  }[state]

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const onPlate = maskHead[i] === 1
      const inSlot = !maskAll[i] && hullHead[i] === 1
      if (!onPlate && !inSlot) continue
      const b = faceBlob(x, y, cfg.size)
      if (b < 0.01) continue
      if (onPlate) {
        // Lines carry most of the light; a faint wash fills between them.
        set(i, ORANGE, (lineFace[i] * 1.6 + 0.26) * b * cfg.power)
      } else {
        // The seams and the eye slot burn: this is where the machine shows.
        const g = Math.exp(-dout[i] / 13) * b * cfg.power
        set(i, ORANGE, g * 1.5)
        set(i, HOT, g * g * 0.5)
      }

      if (state === 'thinking') {
        const dx = x - FACE.cx
        const dy = y - (FACE.cy - 24)
        const r = Math.hypot(dx, dy)
        const ang = Math.atan2(dy, dx)
        // A spiral drawing in toward a hot point: the picture of attention.
        const sp = Math.pow(0.5 + 0.5 * Math.cos(r / 5.2 - ang * 2.0), 5)
        set(i, ORANGE, sp * 0.55 * Math.exp(-r / 95))
        set(i, HOT, Math.exp(-(r * r) / 140) * 1.9)
        set(i, ORANGE, Math.exp(-(r * r) / 1100) * 0.7)
      }
    }
  }

  if (state === 'listening') {
    // Waves arriving at the ear fins from either side.
    for (const side of [-1, 1]) {
      const ex = CX + side * 204
      const ey = 380
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const d = Math.hypot(x - ex, y - ey)
          if (d > 230 || d < 22) continue
          const outward = side * (x - ex)
          if (outward < -6) continue // only the open side
          const ring = Math.pow(0.5 + 0.5 * Math.cos(d / 5.2 - 0.3), 7)
          const k = ring * Math.exp(-d / 105) * 0.55
          const i = y * W + x
          f[i * 3] += 0.55 * k
          f[i * 3 + 1] += 0.95 * k
          f[i * 3 + 2] += 1.0 * k
        }
      }
    }
  }

  if (state === 'speaking' || state === 'strong') {
    // A voice-print across the lower face: mirrored bars, tall in the middle.
    const bars = 35
    const gain = state === 'strong' ? 1.0 : 0.6
    const r = rng(state === 'strong' ? 7 : 3)
    for (let k = 0; k < bars; k++) {
      const x = CX - 84 + (k / (bars - 1)) * 168
      const env = Math.exp(-(((x - CX) / 58) ** 2))
      const hh = (8 + 48 * r() * env + 8 * env) * gain + 3
      for (let t = -hh; t <= hh; t += 0.8) {
        const k2 = (1 - Math.abs(t) / hh) * 0.9 + 0.25
        splat(f, x, 590 + t, ORANGE, 0.5 * k2, 0.95)
        if (Math.abs(t) < hh * 0.35) splat(f, x, 590 + t, HOT, 0.12 * gain, 0.8)
      }
    }
    // A bright seam under the brow that swells with the voice.
    for (let x = CX - 110; x <= CX + 110; x++) {
      splat(f, x, 552 + Math.sin(x * 0.05) * 3, ORANGE, 0.12 * gain, 1.4)
    }
  }
  return f
}

const STATES = ['idle', 'listening', 'thinking', 'speaking', 'strong']

for (let i = 0; i < N * 3; i++) structure[i] = linesB[i] + rimB[i] + dustB[i] + redRimB[i] + streakB[i] + lightsB[i]

function composite(face) {
  const out = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) {
    const x = i % W
    const y = (i / W) | 0
    // Under the orange glow the cyan lines give way to it.
    const dim = maskHead[i] ? 1 - 0.8 * clamp(faceBlob(x, y, 1.05)) : 1
    for (let c = 0; c < 3; c++) {
      out[i * 3 + c] = structure[i * 3 + c] * dim + veins[i * 3 + c] * 0.9 + face[i * 3 + c]
    }
  }
  return out
}

writePng('lines.png', linesB, W, H)
writePng('rim.png', rimB, W, H)
writePng('dust.png', dustB, W, H)
writePng('redrim.png', redRimB, W, H)
writePng('streak.png', streakB, W, H)
writePng('lights.png', lightsB, W, H)
writePng('structure.png', structure, W, H)
writePng('veins.png', veins, W, H)
for (const s of STATES) {
  const face = faceLayer(s)
  writePng(`face-${s}.png`, face, W, H)
  writePng(`preview-${s}.png`, composite(face), W, H)
}

/* -------------------------------------------------------------- backdrop */

// Two ranges of energy ridges, one to each side, hollowed out in the middle so
// the figure has the stage to itself. Drawn as stacked contour lines — each a
// row of dots — which is the same visual language as the figure.
const BW = 2048
const BH = 760
const bd = new Float32Array(BW * BH * 3)
function bsplat(x, y, c, k, r = 0.9) {
  const R = Math.ceil(r * 2)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  for (let j = -R; j <= R; j++) {
    for (let i = -R; i <= R; i++) {
      const px = x0 + i
      const py = y0 + j
      if (px < 0 || py < 0 || px >= BW || py >= BH) continue
      const dx = px + 0.5 - x
      const dy = py + 0.5 - y
      const w = Math.exp(-(dx * dx + dy * dy) / (r * r))
      const o = (py * BW + px) * 3
      bd[o] += c[0] * k * w
      bd[o + 1] += c[1] * k * w
      bd[o + 2] += c[2] * k * w
    }
  }
}
const LAYERS = 44
for (let L = 0; L < LAYERS; L++) {
  const depth = L / (LAYERS - 1) // 0 far, 1 near
  const base = lerp(330, 700, Math.pow(depth, 0.9))
  const amp = lerp(120, 330, depth)
  const seed = L * 7.31
  for (let x = 0; x < BW; x += 1.4) {
    const u = Math.abs(x / BW - 0.5) * 2 // 0 centre, 1 edge
    const side = smooth(0.2, 0.62, u)
    const ridge = Math.pow(fbm(x * 0.0036 + seed * 0.012, seed * 0.3 + L * 0.2, 5), 1.9) * 2.6
    const h = ridge * amp * side
    const y = base - h
    if (y < 0 || y >= BH) continue
    // Each ridgeline mixes cyan with veins of orange where a slow noise peaks.
    const hot = smooth(0.58, 0.78, fbm(x * 0.006 + L * 3.1, L * 1.7, 3))
    const c = [lerp(CYAN[0], ORANGE[0], hot), lerp(CYAN[1], ORANGE[1], hot), lerp(CYAN[2], ORANGE[2], hot)]
    const k = (0.22 + depth * 0.55) * Math.pow(side, 0.7) * (0.6 + 0.8 * hash2(Math.floor(x), L))
    if (k < 0.01) continue
    bsplat(x, y, c, k, 0.8 + depth * 0.5)
    // Hatching down the face of the ridge, thinning as it falls.
    if (hash2(Math.floor(x * 0.7), L + 99) < 0.62) {
      const drop = (30 + 90 * hash2(L, Math.floor(x))) * (0.35 + depth)
      for (let t = 4; t < drop; t += 2.4) {
        bsplat(x, y + t, c, k * 0.42 * Math.pow(1 - t / drop, 1.4), 0.65)
      }
    }
  }
}
// Scattered sparks.
for (let n = 0; n < 2600; n++) {
  const x = rand() * BW
  const u = Math.abs(x / BW - 0.5) * 2
  if (rand() > smooth(0.2, 0.7, u)) continue
  const y = 120 + rand() * 620
  const hot = rand() < 0.3
  bsplat(x, y, hot ? ORANGE : CYAN, 0.25 + rand() * 0.8, 0.7)
}
writePng('backdrop.png', bd, BW, BH)

fs.writeFileSync(
  path.join(OUT, 'meta.json'),
  JSON.stringify({ W, H, BW, BH, face: FACE, states: STATES }, null, 2),
)
