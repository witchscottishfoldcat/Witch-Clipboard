import { clipboard, nativeImage } from 'electron'
import type { ItemStore } from './store'
import type { WatcherHandle } from './watcher'
import { writeClipboardFiles } from './win32'

export interface ClipboardWriteDeps {
  store: ItemStore
  watcher: WatcherHandle | null
}

/**
 * 把某条记录写入系统剪贴板。
 * 写完同步监听器的基线，避免把我们自己的写入再次收进历史。
 */
export function writeItemToClipboard(deps: ClipboardWriteDeps, id: number): boolean {
  const item = deps.store.get(id)
  if (!item) return false

  if (item.kind === 'files') {
    const paths = (item.text ?? '').split('\n').filter(Boolean)
    if (paths.length === 0) return false
    if (!writeClipboardFiles(paths)) {
      console.warn('[clipboard] CF_HDROP 写入失败，退回写路径文本')
      clipboard.writeText(paths.join('\n'))
    }
  } else if (item.kind === 'image') {
    const png = deps.store.imagePng(id)
    if (!png) {
      console.error(`[clipboard] 条目 ${id} 的图片数据缺失`)
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
