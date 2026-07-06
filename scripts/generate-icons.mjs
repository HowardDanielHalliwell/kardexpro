// Genera íconos PWA placeholder: cuadro navy con una "K" naranja.
// PNG codificado a mano (sin dependencias): RGBA 8-bit + zlib de Node.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = join(__dirname, '..', 'public')
mkdirSync(publicDir, { recursive: true })

const NAVY = [0x1a, 0x2d, 0x6b, 255]
const ORANGE = [0xf4, 0x79, 0x20, 255]

// CRC32 (tabla estándar PNG)
const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c >>> 0
}
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

// Distancia de un punto a un segmento (para trazar las diagonales de la K)
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const cx = x1 + t * dx, cy = y1 + t * dy
  return Math.hypot(px - cx, py - cy)
}

function makeIcon(size) {
  const px = new Uint8Array(size * size * 4)
  // Geometría de la "K" en coordenadas relativas
  const barX1 = 0.30 * size, barX2 = 0.42 * size
  const top = 0.24 * size, bottom = 0.76 * size
  const midY = 0.52 * size
  const stroke = 0.065 * size

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let color = NAVY
      const inBar = x >= barX1 && x <= barX2 && y >= top && y <= bottom
      const dUp = distToSegment(x, y, barX2 - stroke * 0.5, midY, 0.72 * size, top + stroke)
      const dDown = distToSegment(x, y, barX2 - stroke * 0.5, midY, 0.74 * size, bottom - stroke)
      if (inBar || dUp <= stroke || dDown <= stroke) color = ORANGE
      const i = (y * size + x) * 4
      px[i] = color[0]; px[i + 1] = color[1]; px[i + 2] = color[2]; px[i + 3] = color[3]
    }
  }

  // Scanlines con byte de filtro 0
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // color type RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
  return png
}

for (const size of [192, 512]) {
  const file = join(publicDir, `pwa-${size}x${size}.png`)
  writeFileSync(file, makeIcon(size))
  console.log(`✔ ${file}`)
}
