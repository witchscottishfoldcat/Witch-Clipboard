import { join } from 'node:path'
import { BrowserWindow, screen, shell, app } from 'electron'
import { rememberForegroundWindow } from './paste'
import { autoHideDisabled, claimForeground, watchOutsideClick } from './dismiss'

const PANEL_W = 820
const PANEL_H = 540
/** 隐藏后一段时间仍未使用就销毁 renderer，兼顾再次唤出的速度和长期驻留内存。 */
const IDLE_RELEASE_MS = 60_000

let panel: BrowserWindow | null = null
let releaseTimer: NodeJS.Timeout | null = null
let destroyingPanel: BrowserWindow | null = null
let beforeShow: (() => void) | null = null

export function getPanel(): BrowserWindow | null {
  return panel
}

export function createPanel(): BrowserWindow {
  if (panel && !panel.isDestroyed()) return panel

  const win = new BrowserWindow({
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

  panel = win
  win.setAlwaysOnTop(true, 'pop-up-menu')
  win.setMenuBarVisibility(false)

  // 面板是常驻的：关闭按钮只隐藏，退出走托盘
  win.on('close', (e) => {
    if (isQuitting() || destroyingPanel === win) return
    e.preventDefault()
    hidePanel()
  })

  win.on('closed', () => {
    if (panel === win) {
      panel = null
      cancelRelease()
      stopWatch?.()
      stopWatch = null
    }
    if (destroyingPanel === win) destroyingPanel = null
  })

  // 点到别处就收起（WCC_NO_AUTOHIDE=1 可关掉，方便开发时截图）
  win.on('blur', () => {
    if (autoHideDisabled()) return
    if (win.webContents.isDevToolsFocused()) return
    hidePanel()
  })

  win.on('show', () => notifyShown(win))

  // 外链走系统浏览器，绝不在面板里打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

/** 由启动模块注入，避免 window.ts 与 mini.ts 形成循环依赖。 */
export function setPanelBeforeShow(callback: () => void): void {
  beforeShow = callback
}

/** 立即释放完整面板及其 renderer；切换到迷你面板时调用。 */
export function releasePanel(): void {
  cancelRelease()
  stopWatch?.()
  stopWatch = null
  const win = panel
  if (!win || win.isDestroyed()) {
    panel = null
    return
  }
  destroyingPanel = win
  panel = null
  win.destroy()
}

/**
 * 是否正在退出。
 * 常驻托盘的窗口都会拦截 close（点 × 只隐藏），退出时必须放行——
 * 只要有一个窗口忘了判断这个标志，app.quit() 就会被它一直否决，
 * 应用永远退不掉，只能上任务管理器。
 */
let quitting = false

export function markQuitting(): void {
  quitting = true
  cancelRelease()
}

export function isQuitting(): boolean {
  return quitting
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
  beforeShow?.()
  cancelRelease()
  const win = panel ?? createPanel()
  // 抢焦点之前记下原来的前台窗口，粘贴时要还给它
  rememberForegroundWindow()
  if (anchor) positionNearTray(win, anchor)
  else positionNearCursor(win)
  claimForeground(win)

  stopWatch?.()
  stopWatch = watchOutsideClick(win, hidePanel)
}

export function hidePanel(): void {
  stopWatch?.()
  stopWatch = null
  if (panel?.isVisible()) hiddenAt = Date.now()
  panel?.hide()
  scheduleRelease()
}

function cancelRelease(): void {
  if (releaseTimer) clearTimeout(releaseTimer)
  releaseTimer = null
}

function scheduleRelease(): void {
  cancelRelease()
  if (!panel || panel.isDestroyed()) return
  releaseTimer = setTimeout(() => {
    releaseTimer = null
    if (panel && !panel.isVisible()) releasePanel()
  }, IDLE_RELEASE_MS)
  releaseTimer.unref()
}

/** 首次显示要等页面加载完；之后每次显示都让隐藏期间的数据补一次刷新。 */
function notifyShown(win: BrowserWindow): void {
  const notify = (): void => {
    if (win.isDestroyed() || !win.isVisible()) return
    win.webContents.send('panel:shown')
    win.webContents.send('items:changed')
  }
  if (win.webContents.isLoadingMainFrame()) win.webContents.once('did-finish-load', notify)
  else notify()
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
