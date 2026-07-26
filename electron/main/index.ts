import { app, BrowserWindow } from 'electron'
import { createPanel, showPanel, markQuitting } from './window'
import { createTray, updateTrayTooltip } from './tray'
import { registerHotkey, unregisterHotkey, currentHotkey } from './shortcuts'
import { registerIpc } from './ipc'
import { MemoryStore } from './store'

// 只允许一个实例；第二次启动等于唤出面板
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.exit(0)
} else {
  app.on('second-instance', () => showPanel())
  bootstrap()
}

function bootstrap(): void {
  // 常驻托盘应用，不需要出现在任务栏/Dock
  app.setAppUserModelId('com.ztb.clipboard')

  void app.whenReady().then(() => {
    // P0：内存仓库 + 演示数据。P1 换成 SQLite 实现，其余代码不动。
    const store = new MemoryStore()

    registerIpc(store)
    createPanel()

    const ok = registerHotkey()
    createTray()
    updateTrayTooltip(ok ? `ZTB 粘贴板 · ${currentHotkey()}` : 'ZTB 粘贴板 · 热键被占用')

    if (!app.isPackaged) {
      // 开发时直接把面板亮出来，省得每次按热键
      showPanel()
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createPanel()
      showPanel()
    })
  })

  // 托盘应用：所有窗口关闭也不退出
  app.on('window-all-closed', () => {})

  app.on('before-quit', () => {
    markQuitting()
    unregisterHotkey()
  })
}
