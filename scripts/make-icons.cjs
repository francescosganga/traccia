// Generates the tray template icons and the app icon as PNGs (no dependencies).
const { deflateSync } = require('zlib')
const { writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5)
      const o = y * (width * 4 + 1) + 1 + x * 4
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
// Anti-aliased coverage of a circle of radius r centred at (cx, cy), via supersampling.
function coverage(x, y, cx, cy, r) {
  let inside = 0
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const dx = x - 0.375 + i * 0.25 - cx, dy = y - 0.375 + j * 0.25 - cy
    if (dx * dx + dy * dy <= r * r) inside++
  }
  return inside / 16
}

const root = join(__dirname, '..')
mkdirSync(join(root, 'resources'), { recursive: true })
mkdirSync(join(root, 'build'), { recursive: true })

// Tray: a "record" glyph — ring + dot — as a black template image.
for (const [size, name] of [[16, 'trayTemplate.png'], [32, 'trayTemplate@2x.png']]) {
  const s = size / 16
  writeFileSync(join(root, 'resources', name), png(size, size, (x, y) => {
    const c = size / 2
    const ring = coverage(x, y, c, c, 7 * s) - coverage(x, y, c, c, 5.6 * s)
    const dot = coverage(x, y, c, c, 3.2 * s)
    return [0, 0, 0, Math.round(Math.min(1, ring + dot) * 255)]
  }))
}

// App icon: rounded dark square with a red record dot.
const S = 1024
writeFileSync(join(root, 'build', 'icon.png'), png(S, S, (x, y) => {
  const pad = S * 0.08, R = S * 0.2
  const inX = x > pad && x < S - pad, inY = y > pad && y < S - pad
  if (!inX || !inY) return [0, 0, 0, 0]
  // rounded corners
  const cx = x < pad + R ? pad + R : x > S - pad - R ? S - pad - R : x
  const cy = y < pad + R ? pad + R : y > S - pad - R ? S - pad - R : y
  const corner = (x < pad + R || x > S - pad - R) && (y < pad + R || y > S - pad - R)
  const a = corner ? coverage(x, y, cx, cy, R) : 1
  if (a === 0) return [0, 0, 0, 0]
  const ring = coverage(x, y, S / 2, S / 2, S * 0.3) - coverage(x, y, S / 2, S / 2, S * 0.25)
  const dot = coverage(x, y, S / 2, S / 2, S * 0.16)
  const red = Math.min(1, ring + dot)
  const r = Math.round(26 + (229 - 26) * red), g = Math.round(26 + (72 - 26) * red), b = Math.round(31 + (77 - 31) * red)
  return [r, g, b, Math.round(a * 255)]
}))
console.log('icons written')
