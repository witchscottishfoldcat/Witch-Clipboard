import type { ZtbApi } from '@shared/types'

declare global {
  interface Window {
    ztb?: ZtbApi
  }
}

/** 纯浏览器里打开时（没有 preload）用的空实现，避免整页崩掉 */
const fallback: ZtbApi = {
  list: async () => ({ items: [], total: 0 }),
  stats: async () => ({ total: 0, pinned: 0, images: 0, bytes: 0 }),
  tags: async () => [],
  setTags: async () => {},
  togglePin: async () => {},
  remove: async () => {},
  clearAll: async () => {},
  copy: async () => {},
  paste: async () => {},
  hidePanel: async () => {},
  getSettings: async () => ({
    hotkey: 'Alt+V',
    maxItems: 2000,
    maxDays: 30,
    skipSensitive: true,
    hideAfterPaste: true,
    theme: 'system',
  }),
  saveSettings: async (patch) => ({
    hotkey: 'Alt+V',
    maxItems: 2000,
    maxDays: 30,
    skipSensitive: true,
    hideAfterPaste: true,
    theme: 'system',
    ...patch,
  }),
  onChanged: () => () => {},
  onPanelShown: () => () => {},
}

export const api: ZtbApi = window.ztb ?? fallback
export const isDesktop = Boolean(window.ztb)
