import { app, BrowserWindow } from 'electron'
import { createPanel, showPanel, markQuitting } from './window'
import { createTray, updateTrayTooltip } from './tray'
import { registerHotkey, unregisterHotkey, currentHotkey } from './shortcuts'
import { registerIpc } from './ipc'
import { MemoryStore, type ItemStore } from './store'
import { startWatcher, type WatcherHandle } from './watcher'
import { SqliteStore } from '../data/store-sqlite'
import { startRetention } from '../data/retention'
import { getSettings } from './settings'

if (process.argv.includes('--self-test')) {
  // 自检模式：跑存储层断言后退出，不建窗口也不注册热键
  void import('./selftest').then((m) => m.runSelfTest())
} else {
  // 只允许一个实例；第二次启动等于唤出面板
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.exit(0)
  } else {
    app.on('second-instance', () => showPanel())
    bootstrap()
  }
}

function bootstrap(): void {
  app.setAppUserModelId('com.ztb.clipboard')

  let store: ItemStore | null = null
  let watcher: WatcherHandle | null = null
  let stopRetention: (() => void) | null = null

  void app.whenReady().then(() => {
    // 数据库打不开时降级到内存，保证应用还能用（会明确告诉用户）
    let memoryFallback = false
    try {
      store = new SqliteStore()
    } catch (err) {
      console.error('[main] SQLite 不可用，降级到内存存储：', err)
      store = new MemoryStore()
      memoryFallback = true
    }

    createPanel()

    const broadcastChanged = (): void => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send('items:changed')
    }

    watcher = startWatcher(store, broadcastChanged)
    registerIpc({ store, watcher, memoryFallback })
    stopRetention = startRetention(store, broadcastChanged)

    const ok = registerHotkey()
    createTray()
    updateTrayTooltip(ok ? `ZTB 粘贴板 · ${currentHotkey()}` : 'ZTB 粘贴板 · 热键被占用')

    // 开机自启的设置以配置为准，避免用户在系统里改过之后两边不一致
    const { autoLaunch } = getSettings()
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: autoLaunch, args: ['--hidden'] })
    }

    // --hidden 是开机自启用的：只驻托盘
    const silent = process.argv.includes('--hidden')
    if (!silent && !app.isPackaged) showPanel()

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
    watcher?.stop()
    stopRetention?.()
    store?.close()
  })
}
