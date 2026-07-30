import { contextBridge, ipcRenderer } from 'electron'
import type { ClipboardApi, ListQuery, Settings, UpdateStatus } from '@shared/types'

/** 渲染进程只能看到这份白名单，没有 node / 没有裸 ipcRenderer */
const api: ClipboardApi = {
  list: (query: ListQuery) => ipcRenderer.invoke('items:list', query),
  stats: () => ipcRenderer.invoke('items:stats'),
  tags: () => ipcRenderer.invoke('items:tags'),
  setTags: (id, tags) => ipcRenderer.invoke('items:setTags', id, tags),
  togglePin: (id) => ipcRenderer.invoke('items:togglePin', id),
  remove: (id) => ipcRenderer.invoke('items:remove', id),
  clearAll: () => ipcRenderer.invoke('items:clear'),
  copy: (id) => ipcRenderer.invoke('items:copy', id),
  paste: (id) => ipcRenderer.invoke('items:paste', id),
  imageDataUrl: (id) => ipcRenderer.invoke('items:image', id),
  relatedItems: (id, limit) => ipcRenderer.invoke('items:related', id, limit),
  hidePanel: () => ipcRenderer.invoke('panel:hide'),
  expandPanel: () => ipcRenderer.invoke('panel:expand'),
  revealFile: (id) => ipcRenderer.invoke('items:reveal', id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:save', patch),
  security: () => ipcRenderer.invoke('app:security'),

  startCrossDevice: () => ipcRenderer.invoke('cross-device:start'),
  stopCrossDevice: () => ipcRenderer.invoke('cross-device:stop'),
  crossDeviceStatus: () => ipcRenderer.invoke('cross-device:status'),
  sendCrossDeviceItem: (id) => ipcRenderer.invoke('cross-device:send-item', id),

  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  skipUpdate: (version) => ipcRenderer.invoke('update:skip', version),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  onUpdateStatus: (cb) => {
    const handler = (_e: unknown, status: UpdateStatus): void => cb(status)
    ipcRenderer.on('update:status', handler)
    return () => ipcRenderer.off('update:status', handler)
  },
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),

  onChanged: (cb) => {
    const handler = (): void => cb()
    ipcRenderer.on('items:changed', handler)
    return () => ipcRenderer.off('items:changed', handler)
  },
  onPanelShown: (cb) => {
    const handler = (): void => cb()
    ipcRenderer.on('panel:shown', handler)
    return () => ipcRenderer.off('panel:shown', handler)
  },
}

contextBridge.exposeInMainWorld('witchcat', api)
