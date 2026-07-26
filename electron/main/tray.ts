import { join } from 'node:path'
import { app, Menu, Tray, nativeImage } from 'electron'
import { showPanel, togglePanel, markQuitting } from './window'
import { currentHotkey } from './shortcuts'

let tray: Tray | null = null

export function createTray(): Tray {
  const iconPath = join(app.getAppPath(), 'resources', 'tray.png')
  const image = nativeImage.createFromPath(iconPath)
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)

  tray.setToolTip(`ZTB 粘贴板 · ${currentHotkey() ?? '热键未注册'}`)
  tray.on('click', () => togglePanel())

  const menu = Menu.buildFromTemplate([
    { label: `显示面板 (${currentHotkey() ?? '未注册'})`, click: () => showPanel() },
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

  return tray
}

export function updateTrayTooltip(text: string): void {
  tray?.setToolTip(text)
}
