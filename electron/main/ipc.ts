import { ipcMain, clipboard, nativeImage, BrowserWindow } from 'electron'
import type { ListQuery, Settings } from '@shared/types'
import type { ItemStore } from './store'
import { getSettings, saveSettings } from './settings'
import { hidePanel } from './window'
import { registerHotkey } from './shortcuts'
import { pasteToPreviousWindow } from './paste'

function broadcast(channel: string): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel)
}

/** 把某条记录写入系统剪贴板；返回是否成功 */
function writeToClipboard(store: ItemStore, id: number): boolean {
  const item = store.get(id)
  if (!item) return false

  if (item.kind === 'image') {
    const path = store.blobPath(id)
    if (!path) return false
    const img = nativeImage.createFromPath(path)
    if (img.isEmpty()) return false
    clipboard.writeImage(img)
  } else {
    clipboard.writeText(item.text ?? '')
  }
  store.touch(id)
  return true
}

export function registerIpc(store: ItemStore): void {
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
    writeToClipboard(store, id)
    broadcast('items:changed')
  })

  ipcMain.handle('items:paste', async (_e, id: number) => {
    if (!writeToClipboard(store, id)) return
    if (getSettings().hideAfterPaste) hidePanel()
    await pasteToPreviousWindow()
    broadcast('items:changed')
  })

  ipcMain.handle('panel:hide', () => hidePanel())

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => {
    const before = getSettings().hotkey
    const next = saveSettings(patch)
    if (next.hotkey !== before) registerHotkey(next.hotkey)
    return next
  })
}
