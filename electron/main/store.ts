import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { app, nativeImage } from 'electron'
import type { ClipItem, ListQuery, ListResult, Stats } from '@shared/types'
import { classify, makePreview } from '@shared/classify'

/**
 * 条目仓库接口。
 * P0 用内存实现（带演示数据）；P1 会用 SQLite + FTS5 + 加密 blob 实现同一接口，
 * 上层（IPC / 渲染进程）不需要任何改动。
 */
export interface ItemStore {
  list(query: ListQuery): ListResult
  get(id: number): ClipItem | undefined
  /** 取图片原始文件路径，用于写回系统剪贴板 */
  blobPath(id: number): string | null
  tags(): string[]
  setTags(id: number, tags: string[]): void
  togglePin(id: number): void
  remove(id: number): void
  clearAll(): void
  touch(id: number): void
  stats(): Stats
}

const DAY = 86_400_000
const HOUR = 3_600_000
const MIN = 60_000

function resourcePath(...parts: string[]): string {
  // 开发时资源在项目根，打包后在 resources/
  const candidates = [
    join(app.getAppPath(), 'resources', ...parts),
    join(process.resourcesPath ?? '', ...parts),
  ]
  return candidates.find((p) => existsSync(p)) ?? candidates[0]
}

/** 内存仓库：P0 用来把界面跑起来 */
export class MemoryStore implements ItemStore {
  private items: ClipItem[] = []
  private blobs = new Map<number, string>()
  private nextId = 1

  constructor(seed = true) {
    if (seed) this.seed()
  }

  private addText(text: string, opts: Partial<ClipItem> = {}): ClipItem {
    const now = Date.now()
    const item: ClipItem = {
      id: this.nextId++,
      kind: 'text',
      text,
      preview: makePreview(text),
      thumb: null,
      width: null,
      height: null,
      bytes: Buffer.byteLength(text, 'utf8'),
      sourceApp: null,
      autoKind: classify(text),
      tags: [],
      pinned: false,
      useCount: 0,
      createdAt: now,
      lastUsedAt: now,
      ...opts,
    }
    this.items.push(item)
    return item
  }

  private addImage(file: string, label: string, opts: Partial<ClipItem> = {}): ClipItem | null {
    const path = resourcePath('demo', file)
    if (!existsSync(path)) return null
    const img = nativeImage.createFromPath(path)
    const { width, height } = img.getSize()
    const now = Date.now()
    const item: ClipItem = {
      id: this.nextId++,
      kind: 'image',
      text: null,
      preview: label,
      thumb: img.resize({ width: 160, quality: 'good' }).toDataURL(),
      width,
      height,
      bytes: img.toPNG().byteLength,
      sourceApp: null,
      autoKind: 'plain',
      tags: [],
      pinned: false,
      useCount: 0,
      createdAt: now,
      lastUsedAt: now,
      ...opts,
    }
    this.items.push(item)
    this.blobs.set(item.id, path)
    return item
  }

  /** 演示数据：覆盖所有 kind / autoKind / 置顶 / 标签 / 时间跨度 */
  private seed(): void {
    const now = Date.now()
    this.addText('https://github.com/anthropics/claude-code', {
      pinned: true,
      tags: ['工作'],
      sourceApp: 'chrome.exe',
      createdAt: now - 3 * MIN,
      lastUsedAt: now - 3 * MIN,
      useCount: 4,
    })
    this.addText(
      `export function debounce<T extends (...a: any[]) => void>(fn: T, ms = 200) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}`,
      { tags: ['代码片段'], sourceApp: 'Code.exe', createdAt: now - 12 * MIN, lastUsedAt: now - 12 * MIN },
    )
    this.addText('#6366f1', { sourceApp: 'figma.exe', createdAt: now - 26 * MIN, lastUsedAt: now - 26 * MIN })
    this.addText('witchscottishfoldcat@outlook.com', {
      pinned: true,
      tags: ['常用'],
      createdAt: now - 40 * MIN,
      lastUsedAt: now - 2 * MIN,
      useCount: 17,
    })
    this.addImage('demo-shot.png', '截图 · 设计稿局部', {
      tags: ['设计'],
      sourceApp: 'ScreenClip',
      createdAt: now - 55 * MIN,
      lastUsedAt: now - 55 * MIN,
    })
    this.addText('D:\\ADM\\ZTB\\electron\\main\\index.ts', {
      sourceApp: 'explorer.exe',
      createdAt: now - 2 * HOUR,
      lastUsedAt: now - 2 * HOUR,
    })
    this.addText(
      `会议要点
1. 剪贴板面板默认 Alt+V 唤出，失焦即收
2. 图片走内容寻址存储，sha256 去重
3. 保留策略：默认 30 天 / 2000 条`,
      { tags: ['工作'], sourceApp: 'notion.exe', createdAt: now - 5 * HOUR, lastUsedAt: now - 5 * HOUR },
    )
    this.addText('1234567890', { createdAt: now - 8 * HOUR, lastUsedAt: now - 8 * HOUR })
    this.addImage('demo-chart.png', '图表 · 周活跃度', {
      createdAt: now - 1 * DAY,
      lastUsedAt: now - 1 * DAY,
    })
    this.addText(
      'SELECT id, kind, preview FROM items WHERE deleted_at IS NULL ORDER BY pinned DESC, last_used_at DESC LIMIT 50;',
      { tags: ['代码片段'], sourceApp: 'DataGrip.exe', createdAt: now - 2 * DAY, lastUsedAt: now - 2 * DAY },
    )
    this.addText('rgba(139, 92, 246, 0.18)', { createdAt: now - 3 * DAY, lastUsedAt: now - 3 * DAY })
    this.addText(
      '这是一段很长的普通文本，用来检查列表里的截断与预览面板的换行表现。粘贴板需要在中英文混排 mixed content 下都保持排版稳定，不出现抖动或溢出。',
      { createdAt: now - 6 * DAY, lastUsedAt: now - 6 * DAY },
    )
    // 补足一批，验证虚拟滚动
    for (let i = 0; i < 60; i++) {
      this.addText(`历史记录 #${i + 1} · ${'内容'.repeat((i % 7) + 1)}`, {
        createdAt: now - (8 + i) * DAY,
        lastUsedAt: now - (8 + i) * DAY,
      })
    }
  }

  list(query: ListQuery): ListResult {
    const { q = '', kind = null, tag = null, pinnedOnly = false, limit = 200, offset = 0 } = query
    const needle = q.trim().toLowerCase()

    let rows = this.items.filter((it) => {
      if (kind && it.kind !== kind) return false
      if (tag && !it.tags.includes(tag)) return false
      if (pinnedOnly && !it.pinned) return false
      if (needle) {
        const hay = `${it.preview}\n${it.text ?? ''}\n${it.tags.join(' ')}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })

    rows.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.lastUsedAt - a.lastUsedAt
    })

    const total = rows.length
    return { items: rows.slice(offset, offset + limit), total }
  }

  get(id: number): ClipItem | undefined {
    return this.items.find((it) => it.id === id)
  }

  blobPath(id: number): string | null {
    return this.blobs.get(id) ?? null
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
    this.blobs.delete(id)
  }

  clearAll(): void {
    // 置顶条目不参与清空
    const kept = this.items.filter((it) => it.pinned)
    const keptIds = new Set(kept.map((it) => it.id))
    for (const id of [...this.blobs.keys()]) if (!keptIds.has(id)) this.blobs.delete(id)
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
}
