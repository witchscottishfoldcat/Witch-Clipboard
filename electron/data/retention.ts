import type { ItemStore } from '../main/store'
import { getSettings } from '../main/settings'

/** 每 30 分钟扫一次，够及时又不会一直占着数据库 */
const SWEEP_MS = 30 * 60 * 1000

let timer: NodeJS.Timeout | null = null

export function sweep(store: ItemStore): number {
  const { maxItems, maxDays } = getSettings()
  const removed = store.prune({ maxItems, maxDays })
  if (removed > 0) console.log(`[retention] 清理了 ${removed} 条过期/超量记录`)
  return removed
}

export function startRetention(store: ItemStore, onChanged: () => void): () => void {
  const run = (): void => {
    try {
      if (sweep(store) > 0) onChanged()
    } catch (err) {
      console.error('[retention] 清理失败', err)
    }
  }

  run() // 启动先扫一次
  timer = setInterval(run, SWEEP_MS)

  return () => {
    if (timer) clearInterval(timer)
    timer = null
  }
}
