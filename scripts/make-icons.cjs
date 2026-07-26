/**
 * 图标生成：SVG 是唯一的设计母版，PNG 全部由它光栅化出来。
 *
 * 用 Electron（Chromium）渲染 SVG——它本来就在依赖里，不用再引 sharp/resvg 这类
 * 需要编译的依赖。画到 canvas 再取 toDataURL，拿到的是真正带 alpha 的位图，
 * 不受窗口透明度设置影响。
 *
 * 运行：npm run icons
 */
const { app, BrowserWindow, nativeImage } = require('electron')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const RES = join(__dirname, '..', 'resources')

/** [源 SVG, 输出 PNG, 边长] */
const JOBS = [
  ['logo.svg', 'icon.png', 512],
  ['logo.svg', 'icon-256.png', 256],
  ['logo-tray.svg', 'tray.png', 32],
  ['logo-tray.svg', 'tray@2x.png', 64],
]

async function rasterize(win, svgPath, size) {
  const svg = readFileSync(join(RES, svgPath), 'utf8')
  const src = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`

  const dataUrl = await win.webContents.executeJavaScript(
    `(async () => {
      const img = new Image()
      img.src = ${JSON.stringify(src)}
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = ${size}
      canvas.height = ${size}
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, ${size}, ${size})
      return canvas.toDataURL('image/png')
    })()`,
    true,
  )

  const png = nativeImage.createFromDataURL(dataUrl).toPNG()
  if (png.byteLength === 0) throw new Error(`${svgPath} 光栅化结果为空`)
  return png
}

app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({ width: 64, height: 64, show: false })
    await win.loadURL('data:text/html,<meta charset="utf-8"><body></body>')

    mkdirSync(RES, { recursive: true })
    let failed = 0

    for (const [svgPath, out, size] of JOBS) {
      try {
        const png = await rasterize(win, svgPath, size)
        writeFileSync(join(RES, out), png)
        console.log(`✓ resources/${out}  ${size}x${size}  ${(png.byteLength / 1024).toFixed(1)} KB`)
      } catch (err) {
        failed++
        console.error(`✗ resources/${out}  ${err.message}`)
      }
    }

    win.destroy()
    app.exit(failed === 0 ? 0 : 1)
  })
  .catch((err) => {
    console.error('图标生成失败：', err)
    app.exit(1)
  })
