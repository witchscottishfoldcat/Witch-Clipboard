import { join } from 'node:path'
import { BrowserWindow, screen, shell, app } from 'electron'
import { rememberForegroundWindow } from './paste'
import { autoHideDisabled, claimForeground, watchOutsideClick } from './dismiss'

const PANEL_W = 820
const PANEL_H = 540

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

  // 点到别处就收起（WCC_NO_AUTOHIDE=1 可关掉，方便开发时截图）
  panel.on('blur', () => {
    if (autoHideDisabled()) return
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

/** 托盘图标的屏幕矩形，用来让面板贴着图标弹出 */
export interface AnchorRect {
  x: number
  y: number
  width: number
  height: number
}

/** 把窗口夹进工作区，保证四边都不出屏 */
function clampToWorkArea(x: number, y: number, w: number, h: number, near: { x: number; y: number }) {
  const { workArea } = screen.getDisplayNearestPoint(near)
  return {
    x: Math.min(Math.max(x, workArea.x + 8), workArea.x + workArea.width - w - 8),
    y: Math.min(Math.max(y, workArea.y + 8), workArea.y + workArea.height - h - 8),
  }
}

/** 光标附近（热键唤出时用） */
function positionNearCursor(win: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint()
  const [w, h] = win.getSize()
  const { x, y } = clampToWorkArea(
    Math.round(cursor.x - w / 2),
    Math.round(cursor.y - 40),
    w,
    h,
    cursor,
  )
  win.setPosition(x, y, false)
}

/** 贴着托盘图标弹出：右边缘对齐图标右缘，整体压在图标上方 */
function positionNearTray(win: BrowserWindow, anchor: AnchorRect): void {
  const [w, h] = win.getSize()
  const { x, y } = clampToWorkArea(
    Math.round(anchor.x + anchor.width - w),
    Math.round(anchor.y - h - 8),
    w,
    h,
    { x: anchor.x, y: anchor.y },
  )
  win.setPosition(x, y, false)
}

/** 面板最后一次被隐藏的时刻，用于判断托盘那一下点击到底是「唤出」还是「收起」 */
let hiddenAt = 0

/**
 * 面板是不是刚刚才被隐藏。
 * 点托盘图标时窗口会先失焦并自动收起，紧接着才收到 click 事件；
 * 没有这个判断，用户想点托盘收起面板，结果它会立刻又弹回来。
 */
export function hiddenRecently(within = 400): boolean {
  return Date.now() - hiddenAt < within
}

let stopWatch: (() => void) | null = null

export function showPanel(anchor?: AnchorRect): void {
  const win = panel ?? createPanel()
  // 抢焦点之前记下原来的前台窗口，粘贴时要还给它
  rememberForegroundWindow()
  if (anchor) positionNearTray(win, anchor)
  else positionNearCursor(win)
  claimForeground(win)
  win.webContents.send('panel:shown')

  stopWatch?.()
  stopWatch = watchOutsideClick(win, hidePanel)
}

export function hidePanel(): void {
  stopWatch?.()
  stopWatch = null
  if (panel?.isVisible()) hiddenAt = Date.now()
  panel?.hide()
}

/** 热键语义：可见且有焦点才收起；可见但没焦点时置前，不要莫名消失 */
export function togglePanel(): void {
  if (panel?.isVisible() && panel.isFocused()) hidePanel()
  else showPanel()
}

/**
 * 托盘单击语义：可见就收起，不可见就贴着图标弹出。
 * 冷却判断放在这里而不是事件处理器里——它是这个动作语义的一部分：
 * 点托盘时面板会先因失焦收起，紧接着才收到 click，少了这一步用户就永远收不起面板。
 */
export function toggleFromTray(anchor?: AnchorRect): void {
  if (hiddenRecently()) return
  if (panel?.isVisible()) hidePanel()
  else showPanel(anchor)
}
