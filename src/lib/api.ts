import type { ClipboardApi, Settings } from '@shared/types'

declare global {
  interface Window {
    witchcat?: ClipboardApi
  }
}

const DEFAULT_SETTINGS: Settings = {
  hotkey: 'Alt+V',
  quickPasteModifiers: 'Ctrl+Alt',
  maxItems: 2000,
  maxDays: 30,
  skipSensitive: true,
  sensitiveApps: [],
  hideAfterPaste: true,
  trayOpensMini: true,
  visibleFilters: ['all', 'text', 'image', 'files', 'url', 'key'],
  autoLaunch: false,
  theme: 'system',
  accent: 'violet',
  skippedVersion: null,
}

/** 纯浏览器里打开时（没有 preload）用的空实现，避免整页崩掉 */
const fallback: ClipboardApi = {
  list: async () => ({ items: [], total: 0 }),
  stats: async () => ({ total: 0, pinned: 0, images: 0, bytes: 0 }),
  tags: async () => [],
  setTags: async () => {},
  togglePin: async () => {},
  remove: async () => {},
  clearAll: async () => {},
  copy: async () => {},
  paste: async () => ({ ok: false, reason: 'no-native' }),
  imageDataUrl: async () => null,
  hidePanel: async () => {},
  expandPanel: async () => {},
  revealFile: async () => {},
  getSettings: async () => DEFAULT_SETTINGS,
  saveSettings: async (patch) => ({ ...DEFAULT_SETTINGS, ...patch }),
  security: async () => ({
    osProtected: false,
    dbEncrypted: false,
    nativeAvailable: false,
    memoryFallback: true,
    dataDir: '',
  }),
  startCrossDevice: async () => ({
    running: false,
    url: null,
    pairCode: null,
    connected: false,
    lastSeenAt: null,
    lastSentAt: null,
    lastSentPreview: null,
  }),
  stopCrossDevice: async () => ({
    running: false,
    url: null,
    pairCode: null,
    connected: false,
    lastSeenAt: null,
    lastSentAt: null,
    lastSentPreview: null,
  }),
  crossDeviceStatus: async () => ({
    running: false,
    url: null,
    pairCode: null,
    connected: false,
    lastSeenAt: null,
    lastSentAt: null,
    lastSentPreview: null,
  }),
  sendCrossDeviceItem: async () => ({ ok: false, reason: 'not-running' }),
  openDataDir: async () => {},
  checkUpdate: async () => ({ state: 'unsupported', currentVersion: '0.0.0' }),
  downloadUpdate: async () => ({ state: 'unsupported', currentVersion: '0.0.0' }),
  installUpdate: async () => {},
  skipUpdate: async () => ({ state: 'idle', currentVersion: '0.0.0' }),
  updateStatus: async () => ({ state: 'idle', currentVersion: '0.0.0' }),
  onUpdateStatus: () => () => {},
  onChanged: () => () => {},
  onPanelShown: () => () => {},
}

export const api: ClipboardApi = window.witchcat ?? fallback
export const isDesktop = Boolean(window.witchcat)
