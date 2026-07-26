/**
 * 零依赖图标生成器：手写 PNG 编码 + 3x3 超采样抗锯齿。
 * 产出 resources/icon.png、resources/tray.png，以及 P0 演示用的两张图片。
 * 运行：npm run icons
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RES = join(ROOT, 'resources')

/* ---------- PNG 编码 ---------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** shade(u, v) -> [r, g, b, a]，u/v 为 0..1 归一化坐标 */
function render(width, height, shade, ss = 3) {
  const out = Buffer.alloc(width * height * 4)
  const n = ss * ss
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / width
          const v = (y + (sy + 0.5) / ss) / height
          const c = shade(u, v)
          // 预乘后再平均，避免半透明边缘发暗
          const al = c[3] / 255
          r += c[0] * al
          g += c[1] * al
          b += c[2] * al
          a += c[3]
        }
      }
      const i = (y * width + x) * 4
      const alpha = a / n // 0..255
      // 从预乘还原为直通色，避免半透明边缘发暗
      const k = alpha > 0 ? 255 / alpha : 0
      out[i] = Math.round(Math.min(255, (r / n) * k))
      out[i + 1] = Math.round(Math.min(255, (g / n) * k))
      out[i + 2] = Math.round(Math.min(255, (b / n) * k))
      out[i + 3] = Math.round(alpha)
    }
  }
  return out
}

/* ---------- 绘图工具 ---------- */

/** 圆角矩形内部判定，cx/cy 中心，hw/hh 半宽半高，r 圆角 */
function inRoundRect(u, v, cx, cy, hw, hh, r) {
  const dx = Math.abs(u - cx) - (hw - r)
  const dy = Math.abs(v - cy) - (hh - r)
  if (dx <= 0 || dy <= 0) return Math.max(dx, dy) <= 0 ? true : Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) <= r
  return Math.hypot(dx, dy) <= r
}

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]

const INDIGO = [99, 102, 241]
const VIOLET = [168, 85, 247]
const WHITE = [255, 255, 255]

/* ---------- 应用图标 ---------- */

function appIcon(withLines) {
  return (u, v) => {
    if (!inRoundRect(u, v, 0.5, 0.5, 0.5, 0.5, 0.22)) return [0, 0, 0, 0]
    const base = mix(INDIGO, VIOLET, Math.min(1, (u + v) / 2))

    const board = inRoundRect(u, v, 0.5, 0.545, 0.215, 0.265, 0.06)
    const tab = inRoundRect(u, v, 0.5, 0.245, 0.115, 0.055, 0.028)

    if (board || tab) {
      if (withLines) {
        const l1 = inRoundRect(u, v, 0.5, 0.46, 0.125, 0.022, 0.022)
        const l2 = inRoundRect(u, v, 0.5, 0.575, 0.125, 0.022, 0.022)
        const l3 = inRoundRect(u, v, 0.435, 0.69, 0.06, 0.022, 0.022)
        if (l1 || l2 || l3) return [...base, 255]
      }
      return [...WHITE, 255]
    }
    return [...base, 255]
  }
}

/* ---------- 演示图片 ---------- */

function demoShot(u, v) {
  // 深色渐变背景
  let c = mix([30, 27, 75], [49, 46, 129], v)
  // 卡片
  if (inRoundRect(u, v, 0.5, 0.52, 0.42, 0.38, 0.05)) {
    c = mix(c, WHITE, 0.1)
    // 顶部栏
    if (v < 0.24) c = mix(c, WHITE, 0.07)
    // 三个窗口点
    for (let i = 0; i < 3; i++) {
      if (Math.hypot(u - (0.14 + i * 0.045), v - 0.19) < 0.014) {
        c = mix(INDIGO, VIOLET, i / 2)
      }
    }
    // 内容行
    const rows = [0.36, 0.47, 0.58, 0.69]
    for (let i = 0; i < rows.length; i++) {
      const w = [0.3, 0.24, 0.33, 0.16][i]
      if (inRoundRect(u, v, 0.12 + w / 2, rows[i], w / 2, 0.022, 0.022)) {
        c = mix(c, WHITE, i === 0 ? 0.55 : 0.28)
      }
    }
    // 强调块
    if (inRoundRect(u, v, 0.76, 0.62, 0.1, 0.16, 0.04)) {
      c = mix(INDIGO, VIOLET, (v - 0.46) / 0.32)
    }
  }
  return [...c, 255]
}

function demoChart(u, v) {
  let c = mix([24, 24, 37], [39, 39, 62], v)
  const bars = [0.42, 0.62, 0.35, 0.78, 0.55, 0.9, 0.48]
  const n = bars.length
  const gap = 0.02
  const bw = (0.84 - gap * (n - 1)) / n
  for (let i = 0; i < n; i++) {
    const x0 = 0.08 + i * (bw + gap)
    const h = bars[i] * 0.66
    const top = 0.88 - h
    if (inRoundRect(u, v, x0 + bw / 2, top + h / 2, bw / 2, h / 2, Math.min(bw / 2, 0.018))) {
      c = mix(INDIGO, VIOLET, (v - top) / h)
    }
  }
  // 基线
  if (Math.abs(v - 0.89) < 0.004 && u > 0.06 && u < 0.94) c = mix(c, WHITE, 0.25)
  return [...c, 255]
}

/* ---------- 输出 ---------- */

mkdirSync(join(RES, 'demo'), { recursive: true })

const jobs = [
  ['icon.png', 256, 256, appIcon(true)],
  ['tray.png', 32, 32, appIcon(false)],
  ['demo/demo-shot.png', 480, 300, demoShot],
  ['demo/demo-chart.png', 480, 300, demoChart],
]

for (const [name, w, h, shade] of jobs) {
  const png = encodePng(w, h, render(w, h, shade))
  writeFileSync(join(RES, name), png)
  console.log(`✓ resources/${name}  ${w}x${h}  ${(png.length / 1024).toFixed(1)} KB`)
}
