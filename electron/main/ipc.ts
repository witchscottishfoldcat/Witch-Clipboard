import { ipcMain, clipboard, nativeImage, shell, app, BrowserWindow } from 'electron'
import type { ListQuery, PasteOutcome, SecurityInfo, Settings } from '@shared/types'
import type { ItemStore } from './store'
import { MemoryStore } from './store'
import { getSettings, saveSettings } from './settings'
import { hidePanel, showPanel } from './window'
import { getMini, hideMini, showMini } from './mini'
import { registerHotkey } from './shortcuts'
import { pasteToPreviousWindow } from './paste'
import { hasNative, writeClipboardFiles } from './win32'
import { isOsProtected } from '../data/crypto'
import { sweep } from '../data/retention'
import {
  checkForUpdate,
  currentStatus,
  downloadUpdate,
  installUpdate,
  skipVersion,
} from './updater'
import type { WatcherHandle } from './watcher'

export interface IpcDeps {
  store: ItemStore
  watcher: WatcherHandle | null
  /** 数据库不可用、降级到内存时为 true */
  memoryFallback: boolean
}

function broadcast(channel: string): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel)
}

/**
 * 把某条记录写入系统剪贴板。
 * 写完把监听器的基线推到当前序列号，否则我们自己写进去的内容会被当成一次新的复制。
 */
function writeToClipboard(deps: IpcDeps, id: number): boolean {
  const item = deps.store.get(id)
  if (!item) return false

  if (item.kind === 'files') {
    const paths = (item.text ?? '').split('\n').filter(Boolean)
    if (paths.length === 0) return false
    // 先试真正的文件格式，这样粘贴出来是文件本身；不行就退回粘路径文本
    if (!writeClipboardFiles(paths)) {
      console.warn('[ipc] CF_HDROP 写入失败，退回写路径文本')
      clipboard.writeText(paths.join('\n'))
    }
  } else if (item.kind === 'image') {
    const png = deps.store.imagePng(id)
    if (!png) {
      console.error(`[ipc] 条目 ${id} 的图片数据缺失`)
      return false
    }
    const img = nativeImage.createFromBuffer(png)
    if (img.isEmpty()) return false
    clipboard.writeImage(img)
  } else {
    clipboard.writeText(item.text ?? '')
  }

  deps.store.touch(id)
  deps.watcher?.syncAfterOwnWrite()
  return true
}

export function registerIpc(deps: IpcDeps): void {
  const { store } = deps

  ipcMain.handle('items:list', (_e, query: ListQuery) => store.list(query ?? {}))
  ipcMain.handle('items:stats', () => store.stats())
  ipcMain.handle('items:tags', () => store.tags())

  ipcMain.handle('items:setTags', (_e, id: number, tags: string[]) => {
    store.setTags(id, tags)
    broadcast('items:changed')
  })

  ipcMain.handle('items:togglePin', (_e, id: number) => {
    store.togglePin(id)
    broadcast('items:changed')
  })

  ipcMain.handle('items:remove', (_e, id: number) => {
    store.remove(id)
    broadcast('items:changed')
  })

  ipcMain.handle('items:clear', () => {
    store.clearAll()
    broadcast('items:changed')
  })

  ipcMain.handle('items:copy', (_e, id: number) => {
    writeToClipboard(deps, id)
    broadcast('items:changed')
  })

  ipcMain.handle('items:paste', async (event, id: number): Promise<PasteOutcome> => {
    if (!writeToClipboard(deps, id)) return { ok: false, reason: 'not-found' }

    const fromMini = BrowserWindow.fromWebContents(event.sender) === getMini()
    const hidden = getSettings().hideAfterPaste
    if (hidden) {
      if (fromMini) hideMini()
      else hidePanel()
    }

    const result = await pasteToPreviousWindow()
    // 自动粘贴失败时把窗口重新亮出来，否则用户看不到「请手动 Ctrl+V」的提示
    if (!result.ok && hidden) {
      if (fromMini) showMini()
      else showPanel()
    }

    broadcast('items:changed')
    return result
  })

  ipcMain.handle('items:image', (_e, id: number): string | null => {
    const png = store.imagePng(id)
    return png ? `data:image/png;base64,${png.toString('base64')}` : null
  })

  ipcMain.handle('panel:hide', (event) => {
    // 迷你面板和完整面板共用这条通道，谁发的就收谁
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && win === getMini()) hideMini()
    else hidePanel()
  })

  ipcMain.handle('panel:expand', () => {
    hideMini()
    showPanel()
  })

  ipcMain.handle('items:reveal', (_e, id: number) => {
    const item = store.get(id)
    if (item?.kind !== 'files') return
    const first = (item.text ?? '').split('\n').filter(Boolean)[0]
    if (first) shell.showItemInFolder(first)
  })

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => {
    const before = getSettings()
    const next = saveSettings(patch)

    if (next.hotkey !== before.hotkey) registerHotkey(next.hotkey)

    if (next.autoLaunch !== before.autoLaunch) {
      // --hidden：开机自启时只驻托盘，不弹面板
      app.setLoginItemSettings({ openAtLogin: next.autoLaunch, args: ['--hidden'] })
    }

    if (next.maxItems !== before.maxItems || next.maxDays !== before.maxDays) {
      if (sweep(store) > 0) broadcast('items:changed')
    }
    return next
  })

  ipcMain.handle(
    'app:security',
    (): SecurityInfo => ({
      osProtected: deps.memoryFallback ? false : isOsProtected(),
      dbEncrypted: !deps.memoryFallback,
      nativeAvailable: hasNative(),
      memoryFallback: deps.memoryFallback || store instanceof MemoryStore,
      dataDir: app.getPath('userData'),
    }),
  )

  ipcMain.handle('app:openDataDir', () => shell.openPath(app.getPath('userData')))

  ipcMain.handle('update:check', () => checkForUpdate(false))
  ipcMain.handle('update:download', () => downloadUpdate())
  ipcMain.handle('update:install', () => installUpdate())
  ipcMain.handle('update:skip', (_e, version?: string) => skipVersion(version))
  ipcMain.handle('update:status', () => currentStatus())
}
