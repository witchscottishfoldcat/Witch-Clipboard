import type { AutoKind, ClipItem, ItemKind, ListQuery, ListResult, Stats } from '@shared/types'

/** 采集到的新条目 */
export interface NewItem {
  kind: ItemKind
  text: string | null
  preview: string
  autoKind: AutoKind
  /** 内容 sha256，唯一键，用于去重 */
  hash: string
  /** 图片在 blob 仓库里的名字（等于 hash），文本为 null */
  blobName: string | null
  /** 缩略图 PNG */
  thumb: Buffer | null
  width: number | null
  height: number | null
  bytes: number
  sourceApp: string | null
}

export interface AddResult {
  id: number
  /** false 表示命中了已有内容，只更新了使用时间 */
  created: boolean
}

/**
 * 条目仓库接口。
 * 正式实现是 SqliteStore（加密持久化）；MemoryStore 是数据库打不开时的降级实现，
 * 保证应用还能用，只是重启会丢。
 */
export interface ItemStore {
  add(input: NewItem): AddResult
  list(query: ListQuery): ListResult
  get(id: number): ClipItem | undefined
  /** 5 秒内连续复制的关联条目，最多返回 10 条 */
  related(id: number, limit?: number): ClipItem[]
  /** 取解密后的原始 PNG，用于写回剪贴板和大图预览 */
  imagePng(id: number): Buffer | null
  tags(): string[]
  setTags(id: number, tags: string[]): void
  togglePin(id: number): void
  remove(id: number): void
  clearAll(): void
  touch(id: number): void
  stats(): Stats
  /** 保留策略：删掉过期/超量的非置顶条目，返回被删掉的条目数 */
  prune(opts: { maxItems: number; maxDays: number }): number
  /** 仍被引用的图片 hash 集合，用于回收孤儿 blob */
  referencedBlobs(): Set<string>
  close(): void
}

export function thumbToDataUrl(thumb: Buffer | null): string | null {
  return thumb ? `data:image/png;base64,${thumb.toString('base64')}` : null
}

/** 内存实现：仅作为数据库不可用时的降级 */
export class MemoryStore implements ItemStore {
  private items: ClipItem[] = []
  private images = new Map<number, Buffer>()
  private nextId = 1

  add(input: NewItem): AddResult {
    const exist = this.items.find((it) => it.hash === input.hash)
    if (exist) {
      exist.lastUsedAt = Date.now()
      exist.useCount++
      return { id: exist.id, created: false }
    }
    const now = Date.now()
    const item: ClipItem = {
      id: this.nextId++,
      kind: input.kind,
      text: input.text,
      preview: input.preview,
      hash: input.hash,
      thumb: thumbToDataUrl(input.thumb),
      width: input.width,
      height: input.height,
      bytes: input.bytes,
      sourceApp: input.sourceApp,
      autoKind: input.autoKind,
      tags: [],
      pinned: false,
      useCount: 0,
      createdAt: now,
      lastUsedAt: now,
    }
    this.items.unshift(item)
    return { id: item.id, created: true }
  }

  /** 降级模式下原图只留在内存里 */
  keepImage(id: number, png: Buffer): void {
    this.images.set(id, png)
  }

  list(query: ListQuery): ListResult {
    const {
      q = '',
      kind = null,
      autoKind = null,
      tag = null,
      pinnedOnly = false,
      limit = 300,
      offset = 0,
    } = query
    const needle = q.trim().toLowerCase()

    const rows = this.items.filter((it) => {
      if (kind && it.kind !== kind) return false
      if (autoKind && it.autoKind !== autoKind) return false
      if (tag && !it.tags.includes(tag)) return false
      if (pinnedOnly && !it.pinned) return false
      if (needle) {
        const hay = `${it.preview}\n${it.text ?? ''}\n${it.tags.join(' ')}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })

    rows.sort((a, b) => (a.pinned === b.pinned ? b.lastUsedAt - a.lastUsedAt : a.pinned ? -1 : 1))
    return { items: rows.slice(offset, offset + limit), total: rows.length }
  }

  get(id: number): ClipItem | undefined {
    return this.items.find((it) => it.id === id)
  }

  related(id: number, limit = 10): ClipItem[] {
    const base = this.get(id)
    if (!base) return []
    const windowMs = 5_000
    const safeLimit = Math.min(Math.max(limit, 1), 10)
    return this.items
      .filter(
        (item) =>
          item.id !== id &&
          Math.abs(item.lastUsedAt - base.lastUsedAt) <= windowMs,
      )
      .sort(
        (a, b) =>
          Math.abs(a.lastUsedAt - base.lastUsedAt) -
            Math.abs(b.lastUsedAt - base.lastUsedAt) || b.lastUsedAt - a.lastUsedAt,
      )
      .slice(0, safeLimit)
  }

  imagePng(id: number): Buffer | null {
    return this.images.get(id) ?? null
  }

  tags(): string[] {
    const set = new Set<string>()
    for (const it of this.items) for (const t of it.tags) set.add(t)
    return [...set].sort((a, b) => a.localeCompare(b, 'zh'))
  }

  setTags(id: number, tags: string[]): void {
    const it = this.get(id)
    if (it) it.tags = [...new Set(tags.map((t) => t.trim()).filter(Boolean))]
  }

  togglePin(id: number): void {
    const it = this.get(id)
    if (it) it.pinned = !it.pinned
  }

  remove(id: number): void {
    this.items = this.items.filter((it) => it.id !== id)
    this.images.delete(id)
  }

  clearAll(): void {
    const kept = this.items.filter((it) => it.pinned)
    const keptIds = new Set(kept.map((it) => it.id))
    for (const id of [...this.images.keys()]) if (!keptIds.has(id)) this.images.delete(id)
    this.items = kept
  }

  touch(id: number): void {
    const it = this.get(id)
    if (it) {
      it.lastUsedAt = Date.now()
      it.useCount++
    }
  }

  stats(): Stats {
    return {
      total: this.items.length,
      pinned: this.items.filter((it) => it.pinned).length,
      images: this.items.filter((it) => it.kind === 'image').length,
      bytes: this.items.reduce((sum, it) => sum + it.bytes, 0),
    }
  }

  prune({ maxItems, maxDays }: { maxItems: number; maxDays: number }): number {
    const before = this.items.length
    const cutoff = maxDays > 0 ? Date.now() - maxDays * 86_400_000 : 0
    let kept = this.items.filter((it) => it.pinned || cutoff === 0 || it.lastUsedAt >= cutoff)
    if (maxItems > 0) {
      const unpinned = kept.filter((it) => !it.pinned)
      if (unpinned.length > maxItems) {
        const doomed = new Set(unpinned.slice(maxItems).map((it) => it.id))
        kept = kept.filter((it) => !doomed.has(it.id))
      }
    }
    const removed = new Set(this.items.filter((it) => !kept.includes(it)).map((it) => it.id))
    for (const id of removed) this.images.delete(id)
    this.items = kept
    return before - kept.length
  }

  referencedBlobs(): Set<string> {
    return new Set()
  }

  close(): void {
    this.items = []
    this.images.clear()
  }
}
