import { join } from 'node:path'
import { BrowserWindow, screen, shell, app } from 'electron'
import { rememberForegroundWindow } from './paste'

const PANEL_W = 820
const PANEL_H = 540
const isDev = !app.isPackaged

let panel: BrowserWindow | null = null

export function getPanel(): BrowserWindow | null {
  return panel
}

export function createPanel(): BrowserWindow {
  panel = new BrowserWindow({
    width: PANEL_W,
    height: PANEL_H,
    minWidth: 640,
    minHeight: 420,
    show: false,
    frame: true,
    // 保留原生边框以拿到 Win11 圆角 + 亚克力材质，只隐藏标题栏区域
    titleBarStyle: 'hidden',
    // 亚克力材质要求背景透明色，且不能开 transparent: true
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    skipTaskbar: true,
    alwaysOnTop: true,
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

  panel.setAlwaysOnTop(true, 'pop-up-menu')
  panel.setMenuBarVisibility(false)

  // 面板是常驻的：关闭按钮只隐藏，退出走托盘
  panel.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      hidePanel()
    }
  })

  // 失焦即收起（开发模式下保留，方便看 DevTools）
  panel.on('blur', () => {
    if (isDev) return
    if (panel?.webContents.isDevToolsFocused()) return
    hidePanel()
  })

  // 外链走系统浏览器，绝不在面板里打开
  panel.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void panel.loadURL(devUrl)
  } else {
    void panel.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return panel
}

let isQuitting = false
export function markQuitting(): void {
  isQuitting = true
}

/** 把面板放到鼠标所在屏幕的光标附近，并保证完整落在工作区内 */
function positionNearCursor(win: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(cursor)
  const [w, h] = win.getSize()

  let x = Math.round(cursor.x - w / 2)
  let y = Math.round(cursor.y - 40)

  x = Math.min(Math.max(x, workArea.x + 8), workArea.x + workArea.width - w - 8)
  y = Math.min(Math.max(y, workArea.y + 8), workArea.y + workArea.height - h - 8)

  win.setPosition(x, y, false)
}

export function showPanel(): void {
  const win = panel ?? createPanel()
  // 抢焦点之前记下原来的前台窗口，粘贴时要还给它
  rememberForegroundWindow()
  positionNearCursor(win)
  win.show()
  win.focus()
  win.webContents.send('panel:shown')
}

export function hidePanel(): void {
  panel?.hide()
}

export function togglePanel(): void {
  if (panel?.isVisible() && panel.isFocused()) hidePanel()
  else showPanel()
}
