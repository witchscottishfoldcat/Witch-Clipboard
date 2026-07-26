import { join } from 'node:path'
import { app, Menu, Tray, nativeImage } from 'electron'
import {
  showPanel,
  hidePanel,
  toggleFromTray,
  hiddenRecently,
  markQuitting,
  type AnchorRect,
} from './window'
import { currentHotkey } from './shortcuts'

let tray: Tray | null = null

export function createTray(): Tray {
  const iconPath = join(app.getAppPath(), 'resources', 'tray.png')
  const image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) console.error(`[tray] 图标加载失败：${iconPath}`)
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)

  tray.setToolTip(`ZTB 粘贴板 · 单击显示 · ${currentHotkey() ?? '热键未注册'}`)

  // toggleFromTray 内部自带「刚被失焦收起」的冷却判断
  tray.on('click', (_event, bounds) => toggleFromTray(pickAnchor(bounds)))

  // 有些用户习惯双击托盘：第一下已经弹出来了，第二下只要保证仍是显示状态
  tray.on('double-click', (_event, bounds) => {
    if (!hiddenRecently()) return
    showPanel(pickAnchor(bounds))
  })

  const menu = Menu.buildFromTemplate([
    { label: `显示面板 (${currentHotkey() ?? '未注册'})`, click: () => showPanel(trayBounds()) },
    { label: '收起面板', click: () => hidePanel() },
    { type: 'separator' },
    { label: `ZTB v${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        markQuitting()
        app.quit()
      },
    },
  ])
  tray.setContextMenu(menu)

  // Win11 会把新出现的托盘图标收进「溢出」区域，这时 bounds 是 0，用户也看不见图标
  const bounds = tray.getBounds()
  if (bounds.width === 0) {
    console.warn('[tray] 图标可能被收进托盘溢出区，用户需要在任务栏设置里把它固定出来')
  } else if (!app.isPackaged) {
    console.log('[tray] bounds =', JSON.stringify(bounds))
  }

  return tray
}

export function updateTrayTooltip(text: string): void {
  tray?.setToolTip(text)
}

/** 托盘图标矩形；被 Win11 收进溢出区时宽高为 0，这时返回 undefined 让面板退回光标定位 */
function trayBounds(): AnchorRect | undefined {
  return pickAnchor(tray?.getBounds())
}

function pickAnchor(bounds?: AnchorRect): AnchorRect | undefined {
  if (bounds && bounds.width > 0) return bounds
  const own = tray?.getBounds()
  return own && own.width > 0 ? own : undefined
}
