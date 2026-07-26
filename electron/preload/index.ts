import { contextBridge, ipcRenderer } from 'electron'
import type { ListQuery, Settings, ZtbApi } from '@shared/types'

/** 渲染进程只能看到这份白名单，没有 node / 没有裸 ipcRenderer */
const api: ZtbApi = {
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
  hidePanel: () => ipcRenderer.invoke('panel:hide'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:save', patch),
  security: () => ipcRenderer.invoke('app:security'),
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

contextBridge.exposeInMainWorld('ztb', api)
