// Minimal PNG reader/writer on node:zlib, so the art scripts need no packages.
// Reads 8-bit RGB/RGBA/gray, non-interlaced (what image models hand back).

import fs from 'node:fs'
import zlib from 'node:zlib'

/** -> { w, h, rgb: Float32Array(w*h*3) in 0..1 } */
export function readPng(file) {
  const buf = fs.readFileSync(file)
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: not a PNG`)
  let off = 8
  let w = 0
  let h = 0
  let depth = 0
  let ctype = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      depth = data[8]
      ctype = data[9]
      if (data[12] !== 0) throw new Error('interlaced PNG not supported')
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (depth !== 8 || ![0, 2, 6].includes(ctype)) throw new Error(`unsupported PNG (depth ${depth}, type ${ctype})`)
  const bpp = ctype === 0 ? 1 : ctype === 2 ? 3 : 4
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * bpp
  const px = Buffer.alloc(stride * h)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const dst = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0
      const b = y > 0 ? px[dst - stride + x] : 0
      const c = x >= bpp && y > 0 ? px[dst - stride + x - bpp] : 0
      let v = raw[src + x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      px[dst + x] = v & 255
    }
  }
  const rgb = new Float32Array(w * h * 3)
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = px[i * bpp + (bpp === 1 ? 0 : c)] / 255
  }
  return { w, h, rgb }
}

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

/** rgb: Float32Array(w*h*3), 0..1 already display-ready (clamped here). */
export function writePng(file, rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w * 3; x++) {
      const v = rgb[y * w * 3 + x]
      raw[y * (w * 3 + 1) + 1 + x] = Math.round(255 * Math.max(0, Math.min(1, v)))
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}
