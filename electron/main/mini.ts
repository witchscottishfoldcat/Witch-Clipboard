/**
 * 迷你预览面板：单击托盘时贴着图标弹出的小窗。
 * 和完整面板共用同一份渲染层代码，靠 ?mode=mini 切布局。
 */
import { join } from 'node:path'
import { BrowserWindow, app, screen, shell } from 'electron'
import { rememberForegroundWindow } from './paste'
import type { AnchorRect } from './window'

const MINI_W = 340
const MINI_H = 470
const isDev = !app.isPackaged

let mini: BrowserWindow | null = null
let hiddenAt = 0

export function getMini(): BrowserWindow | null {
  return mini
}

export function createMini(): BrowserWindow {
  mini = new BrowserWindow({
    width: MINI_W,
    height: MINI_H,
    show: false,
    frame: true,
    titleBarStyle: 'hidden',
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    icon: join(app.getAppPath(), 'resources', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })

  mini.setAlwaysOnTop(true, 'pop-up-menu')
  mini.setMenuBarVisibility(false)

  mini.on('close', (e) => {
    e.preventDefault()
    hideMini()
  })

  mini.on('blur', () => {
    if (isDev) return
    if (mini?.webContents.isDevToolsFocused()) return
    hideMini()
  })

  if (isDev) {
    // 开发时把渲染进程的日志转到终端，省得为了看一行 log 去开 DevTools
    mini.webContents.on('console-message', (event) => {
      console.log('[mini renderer]', event.message)
    })
  }

  mini.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mini.loadURL(`${devUrl}?mode=mini`)
  } else {
    void mini.loadFile(join(__dirname, '../renderer/index.html'), { search: 'mode=mini' })
  }

  return mini
}

/** 贴着托盘图标弹出，右缘对齐图标右缘、压在任务栏上方 */
function position(win: BrowserWindow, anchor?: AnchorRect): void {
  const [w, h] = win.getSize()
  const near = anchor ? { x: anchor.x, y: anchor.y } : screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(near)

  const rawX = anchor ? anchor.x + anchor.width - w : near.x - w / 2
  const rawY = anchor ? anchor.y - h - 8 : near.y - 40

  win.setPosition(
    Math.min(Math.max(Math.round(rawX), workArea.x + 8), workArea.x + workArea.width - w - 8),
    Math.min(Math.max(Math.round(rawY), workArea.y + 8), workArea.y + workArea.height - h - 8),
    false,
  )
}

export function showMini(anchor?: AnchorRect): void {
  const win = mini ?? createMini()
  // 抢焦点之前记下原来的前台窗口，粘贴时要还给它
  rememberForegroundWindow()
  position(win, anchor)
  win.show()
  win.focus()
  win.webContents.send('panel:shown')
}

export function hideMini(): void {
  if (mini?.isVisible()) hiddenAt = Date.now()
  mini?.hide()
}

export function miniHiddenRecently(within = 400): boolean {
  return Date.now() - hiddenAt < within
}

/**
 * 托盘单击语义，和完整面板一致：
 * 点托盘时窗口会先因失焦收起，紧接着才收到 click，少了冷却判断就永远收不起来。
 */
export function toggleMiniFromTray(anchor?: AnchorRect): void {
  if (miniHiddenRecently()) return
  if (mini?.isVisible()) hideMini()
  else showMini(anchor)
}
