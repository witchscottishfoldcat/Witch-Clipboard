import { clipboard } from 'electron'
import { classify, makePreview } from '@shared/classify'
import { sha256 } from '../data/crypto'
import * as blobs from '../data/blobs'
import { getSettings } from './settings'
import * as win32 from './win32'
import type { ItemStore } from './store'
import { MemoryStore } from './store'

const POLL_MS = 400
/** 超过这个大小的文本不入库（整本小说粘过来只会拖慢一切） */
const MAX_TEXT_BYTES = 1_000_000
const THUMB_WIDTH = 220

let timer: NodeJS.Timeout | null = null
let lastSeq: number | null = null
/** 没有原生序列号时的降级：比对内容指纹 */
let lastFingerprint = ''

export interface WatcherHandle {
  stop(): void
  /**
   * 我们自己写剪贴板之后调用：把序列号基线推到当前值，
   * 这样监听器不会把「刚粘出去的东西」当成新的复制再记一遍。
   */
  syncAfterOwnWrite(): void
  /** 立刻抓一次，用于启动时把已经在剪贴板里的东西收进来 */
  captureNow(): void
}

export function startWatcher(store: ItemStore, onCaptured: () => void): WatcherHandle {
  const tick = (): void => {
    const seq = win32.clipboardSequence()
    if (seq !== null) {
      if (seq === lastSeq) return
      lastSeq = seq
    }
    try {
      capture(store, onCaptured)
    } catch (err) {
      console.error('[watcher] 采集失败', err)
    }
  }

  timer = setInterval(tick, POLL_MS)
  // 启动先记一次基线，别把上次关机前留在剪贴板里的东西当成新内容
  lastSeq = win32.clipboardSequence()

  return {
    stop: () => {
      if (timer) clearInterval(timer)
      timer = null
    },
    syncAfterOwnWrite: () => {
      lastSeq = win32.clipboardSequence()
      lastFingerprint = fingerprint()
    },
    captureNow: () => {
      lastSeq = win32.clipboardSequence()
      capture(store, onCaptured)
    },
  }
}

/** 降级模式用的轻量指纹：只读文本，避免每 400ms 解一次图 */
function fingerprint(): string {
  const text = clipboard.readText()
  if (text) return `t:${text.length}:${text.slice(0, 512)}`
  return `f:${clipboard.availableFormats().join(',')}`
}

function capture(store: ItemStore, onCaptured: () => void): void {
  const settings = getSettings()

  // 密码管理器会给剪贴板打「不要记录」标记
  if (settings.skipSensitive && win32.hasSensitiveMarker()) return

  const foreground = win32.foregroundWindow()
  const exe = foreground?.exe ?? null

  if (settings.skipSensitive && exe && isSensitiveApp(exe, settings.sensitiveApps)) {
    return
  }

  if (win32.clipboardSequence() === null) {
    // 没有原生序列号，用指纹去重
    const fp = fingerprint()
    if (fp === lastFingerprint) return
    lastFingerprint = fp
  }

  const text = clipboard.readText()
  if (text && text.trim()) {
    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes > MAX_TEXT_BYTES) {
      console.warn(`[watcher] 文本过大已跳过：${bytes} 字节`)
      return
    }
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
      bytes,
      sourceApp: exe,
    })
    // 新增和「命中已有内容并上浮」都要刷新列表
    onCaptured()
    return
  }

  if (clipboard.availableFormats().some((f) => f.startsWith('image/'))) {
    const image = clipboard.readImage()
    if (image.isEmpty()) return

    const png = image.toPNG()
    if (png.byteLength === 0) return

    const hash = sha256(png)
    const { width, height } = image.getSize()
    const thumb = image.resize({ width: Math.min(THUMB_WIDTH, width), quality: 'good' }).toPNG()

    let blobName: string | null = null
    try {
      blobName = blobs.put(hash, png)
    } catch (err) {
      console.error('[watcher] 图片落盘失败', err)
    }

    const result = store.add({
      kind: 'image',
      text: null,
      preview: `图片 ${width}×${height}`,
      autoKind: 'plain',
      hash,
      blobName,
      thumb,
      width,
      height,
      bytes: png.byteLength,
      sourceApp: exe,
    })
    // 降级模式没有 blob 仓库，原图先留在内存里
    if (store instanceof MemoryStore) store.keepImage(result.id, png)
    onCaptured()
  }
}

function isSensitiveApp(exe: string, list: string[]): boolean {
  const name = exe.toLowerCase()
  return list.some((p) => p.trim() !== '' && name.includes(p.trim().toLowerCase()))
}
