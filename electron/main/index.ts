import { app, BrowserWindow, clipboard, dialog } from 'electron'
import {
  getPanel,
  hidePanel,
  showPanel,
  markQuitting,
  releasePanel,
  setPanelBeforeShow,
} from './window'
import { getMini, hideMini, releaseMini, setMiniBeforeShow } from './mini'
import { createTray, updateTrayTooltip } from './tray'
import {
  registerHotkey,
  registerQuickPaste,
  setQuickPasteHandler,
  unregisterAllShortcuts,
  currentHotkey,
} from './shortcuts'
import { registerIpc } from './ipc'
import { MemoryStore, type ItemStore } from './store'
import { startWatcher, type WatcherHandle } from './watcher'
import { SqliteStore } from '../data/store-sqlite'
import { startRetention } from '../data/retention'
import { getSettings } from './settings'
import { migrateLegacyData, useCanonicalUserData } from './paths'
import { scheduleStartupCheck } from './updater'
import { pasteToPreviousWindow, rememberForegroundWindow } from './paste'
import { writeItemToClipboard } from './item-clipboard'
import { CrossDeviceService } from './cross-device'
import { classify, makePreview } from '@shared/classify'
import { sha256 } from '../data/crypto'

if (process.argv.includes('--self-test')) {
  // 自检模式：跑断言后退出，不注册热键
  import('./selftest')
    .then((m) => m.runSelfTest())
    .catch((err) => {
      // 不加 catch 的话自检中途抛异常会静默退出，看起来像「跑完了但少打了几行」
      console.error('[selftest] 异常中断：', err)
      app.exit(1)
    })
} else {
  // 单实例锁依赖 userData 路径，所以要先把路径定下来
  const demoUserData = process.env.WCC_DEMO_USER_DATA_DIR
  if (demoUserData) app.setPath('userData', demoUserData)
  else useCanonicalUserData()

  // 只允许一个实例；第二次启动等于唤出面板
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.exit(0)
  } else {
    migrateLegacyData()
    app.on('second-instance', () => showPanel())
    bootstrap()
  }
}

function bootstrap(): void {
  app.setAppUserModelId('com.witchcat.clipboard')

  let store: ItemStore | null = null
  let watcher: WatcherHandle | null = null
  let stopRetention: (() => void) | null = null
  let crossDevice: CrossDeviceService | null = null

  app.whenReady().then(startup).catch((err) => {
    // 启动链路里的异常不能静默：吞掉的话表现就是「托盘有图标但面板永远不出来」
    console.error('[main] 启动失败：', err)
    dialog.showErrorBox('Witch Clipboard 启动失败', String((err as Error)?.stack ?? err))
    app.exit(1)
  })

  function startup(): void {
    // 数据库打不开时降级到内存，保证应用还能用（会明确告诉用户）
    let memoryFallback = false
    try {
      store = new SqliteStore()
    } catch (err) {
      console.error('[main] SQLite 不可用，降级到内存存储：', err)
      store = new MemoryStore()
      memoryFallback = true
    }

    // 窗口按需创建；完整面板和迷你面板互斥，任何时刻最多保留一个 renderer。
    // 隐藏启动时因此可以只运行主进程，不再预加载两份 React 页面。
    setPanelBeforeShow(releaseMini)
    setMiniBeforeShow(releasePanel)

    const broadcastChanged = (): void => {
      // 隐藏窗口在重新显示时会主动刷新，不必在后台为每次复制重复查库。
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isVisible()) win.webContents.send('items:changed')
      }
    }

    const broadcastCrossDevice = (): void => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isVisible()) win.webContents.send('cross-device:changed')
      }
    }

    crossDevice = new CrossDeviceService({
      onPhoneText: (text) => {
        if (!store) return
        clipboard.writeText(text)
        watcher?.syncAfterOwnWrite()
        store.add({
          kind: 'text',
          text,
          preview: makePreview(text),
          autoKind: classify(text),
          hash: sha256(text),
          blobName: null,
          thumb: null,
          width: null,
          height: null,
          bytes: Buffer.byteLength(text, 'utf8'),
          sourceApp: '手机',
        })
        broadcastChanged()
      },
      onStatusChanged: broadcastCrossDevice,
    })

    watcher = startWatcher(store, (itemId) => {
      broadcastChanged()
      const item = store?.get(itemId)
      if (item?.kind === 'text' && item.text) crossDevice?.publishText(item.text)
      if (item?.kind === 'image') {
        const png = store?.imagePng(itemId)
        if (png) crossDevice?.publishImage(png, item.preview)
      }
    })
    registerIpc({ store, watcher, memoryFallback, crossDevice })
    stopRetention = startRetention(store, broadcastChanged)

    let quickPasteBusy = false
    setQuickPasteHandler((index) => {
      if (quickPasteBusy || !store) return
      quickPasteBusy = true

      void (async () => {
        try {
          const focused = BrowserWindow.getFocusedWindow()
          const fromPanel = focused === getPanel()
          const fromMini = focused === getMini()

          // 从外部程序直接按快粘键时，当前前台窗口就是目标；
          // 从面板里按时沿用面板弹出前记住的目标，不能把 Witch Clipboard 自己记成目标。
          if (!fromPanel && !fromMini) rememberForegroundWindow()

          const item = store?.list({ limit: 9 }).items[index]
          if (!item || !store) return
          if (!writeItemToClipboard({ store, watcher }, item.id)) return

          if (fromPanel) hidePanel()
          if (fromMini) hideMini()

          const result = await pasteToPreviousWindow()
          if (!result.ok) {
            console.warn(`[quick-paste] 第 ${index + 1} 条自动粘贴失败: ${result.reason}`)
          }
          broadcastChanged()
        } finally {
          quickPasteBusy = false
        }
      })()
    })

    const ok = registerHotkey()
    const quickPasteOk = registerQuickPaste()
    createTray()
    updateTrayTooltip(
      ok
        ? `Witch Clipboard · ${currentHotkey()}${quickPasteOk ? '' : ' · 快粘热键被占用'}`
        : 'Witch Clipboard · 唤出热键被占用',
    )

    // 开机自启的设置以配置为准，避免用户在系统里改过之后两边不一致
    const { autoLaunch } = getSettings()
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: autoLaunch, args: ['--hidden'] })
    }

    // 启动后延迟查一次更新；查不到、出错、以及用户说过「暂不更新」的版本都不会打扰
    scheduleStartupCheck()

    // --hidden 是开机自启用的：只驻托盘
    const silent = process.argv.includes('--hidden')
    if (!silent && !app.isPackaged) showPanel()

    app.on('activate', () => {
      showPanel()
    })
  }

  // 托盘应用：所有窗口关闭也不退出
  app.on('window-all-closed', () => {})

  app.on('before-quit', () => {
    markQuitting()
    unregisterAllShortcuts()
    watcher?.stop()
    stopRetention?.()
    void crossDevice?.stop()
    store?.close()
  })
}
