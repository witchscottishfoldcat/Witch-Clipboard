import type { ClipItem, ListQuery, ListResult, Stats } from '@shared/types'
import type { AddResult, ItemStore, NewItem } from '../main/store'
import { thumbToDataUrl } from '../main/store'
import { openDb, type Db } from './db'
import * as blobs from './blobs'

interface Row {
  id: number
  kind: string
  text: string | null
  preview: string
  auto_kind: string
  hash: string
  blob_name: string | null
  thumb: Buffer | null
  width: number | null
  height: number | null
  bytes: number
  source_app: string | null
  pinned: number
  use_count: number
  created_at: number
  last_used_at: number
  tags: string | null
}

/** group_concat 用 char(31)（单元分隔符）拼标签，标签名里不可能出现它 */
const TAG_SEP = String.fromCharCode(31)

const SELECT_BASE = `
SELECT i.*, (
  SELECT group_concat(t.name, char(31)) FROM item_tags it
  JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id
) AS tags
FROM items i
`

function toItem(row: Row): ClipItem {
  return {
    id: row.id,
    kind: row.kind as ClipItem['kind'],
    text: row.text,
    preview: row.preview,
    hash: row.hash,
    thumb: thumbToDataUrl(row.thumb),
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    sourceApp: row.source_app,
    autoKind: row.auto_kind as ClipItem['autoKind'],
    tags: row.tags ? row.tags.split(TAG_SEP) : [],
    pinned: row.pinned === 1,
    useCount: row.use_count,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }
}

/** trigram 分词器最短 3 字符；更短的关键词退回 LIKE 扫描 */
const FTS_MIN_LEN = 3

export class SqliteStore implements ItemStore {
  private db: Db

  constructor() {
    this.db = openDb()
  }

  add(input: NewItem): AddResult {
    const now = Date.now()
    const found = this.db.prepare('SELECT id FROM items WHERE hash = ?').get(input.hash) as
      | { id: number }
      | undefined

    if (found) {
      this.db
        .prepare('UPDATE items SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?')
        .run(now, found.id)
      return { id: found.id, created: false }
    }

    const info = this.db
      .prepare(
        `INSERT INTO items
         (kind, text, preview, auto_kind, hash, blob_name, thumb, width, height, bytes,
          source_app, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.kind,
        input.text,
        input.preview,
        input.autoKind,
        input.hash,
        input.blobName,
        input.thumb,
        input.width,
        input.height,
        input.bytes,
        input.sourceApp,
        now,
        now,
      )
    return { id: Number(info.lastInsertRowid), created: true }
  }

  list(query: ListQuery): ListResult {
    const { q = '', kind = null, tag = null, pinnedOnly = false, limit = 300, offset = 0 } = query
    const where: string[] = []
    const params: unknown[] = []

    if (kind) {
      where.push('i.kind = ?')
      params.push(kind)
    }
    if (pinnedOnly) where.push('i.pinned = 1')
    if (tag) {
      where.push(
        'EXISTS (SELECT 1 FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id AND t.name = ?)',
      )
      params.push(tag)
    }

    const needle = q.trim()
    if (needle) {
      if (needle.length >= FTS_MIN_LEN) {
        where.push('i.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)')
        params.push(`"${needle.replace(/"/g, '""')}"`)
      } else {
        // 1~2 字的关键词 trigram 索引覆盖不到，直接扫
        where.push('(i.preview LIKE ? ESCAPE \'\\\' OR i.text LIKE ? ESCAPE \'\\\')')
        const like = `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
        params.push(like, like)
      }
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const total = (
      this.db.prepare(`SELECT count(*) AS c FROM items i ${clause}`).get(...params) as { c: number }
    ).c

    const rows = this.db
      .prepare(
        `${SELECT_BASE} ${clause} ORDER BY i.pinned DESC, i.last_used_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as Row[]

    return { items: rows.map(toItem), total }
  }

  get(id: number): ClipItem | undefined {
    const row = this.db.prepare(`${SELECT_BASE} WHERE i.id = ?`).get(id) as Row | undefined
    return row ? toItem(row) : undefined
  }

  imagePng(id: number): Buffer | null {
    const row = this.db.prepare('SELECT blob_name FROM items WHERE id = ?').get(id) as
      | { blob_name: string | null }
      | undefined
    if (!row?.blob_name) return null
    return blobs.get(row.blob_name)
  }

  tags(): string[] {
    const rows = this.db
      .prepare(
        `SELECT t.name FROM tags t JOIN item_tags it ON it.tag_id = t.id
         GROUP BY t.id ORDER BY count(*) DESC, t.name`,
      )
      .all() as { name: string }[]
    return rows.map((r) => r.name)
  }

  setTags(id: number, names: string[]): void {
    const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, 12)
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(id)
      const upsert = this.db.prepare('INSERT OR IGNORE INTO tags(name) VALUES (?)')
      const findTag = this.db.prepare('SELECT id FROM tags WHERE name = ?')
      const link = this.db.prepare('INSERT OR IGNORE INTO item_tags(item_id, tag_id) VALUES (?, ?)')
      for (const name of clean) {
        upsert.run(name)
        const tag = findTag.get(name) as { id: number }
        link.run(id, tag.id)
      }
      // 清掉没人用的标签，别让筛选栏堆垃圾
      this.db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM item_tags)').run()
    })
    tx()
  }

  togglePin(id: number): void {
    this.db.prepare('UPDATE items SET pinned = 1 - pinned WHERE id = ?').run(id)
  }

  remove(id: number): void {
    const row = this.db.prepare('SELECT blob_name FROM items WHERE id = ?').get(id) as
      | { blob_name: string | null }
      | undefined
    this.db.prepare('DELETE FROM items WHERE id = ?').run(id)
    if (row?.blob_name) this.gcBlob(row.blob_name)
  }

  clearAll(): void {
    this.db.prepare('DELETE FROM items WHERE pinned = 0').run()
    this.db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM item_tags)').run()
    this.gcOrphanBlobs()
  }

  touch(id: number): void {
    this.db
      .prepare('UPDATE items SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?')
      .run(Date.now(), id)
  }

  stats(): Stats {
    const row = this.db
      .prepare(
        `SELECT count(*) AS total,
                sum(pinned) AS pinned,
                sum(kind = 'image') AS images,
                coalesce(sum(bytes), 0) AS bytes
         FROM items`,
      )
      .get() as { total: number; pinned: number | null; images: number | null; bytes: number }
    return {
      total: row.total,
      pinned: row.pinned ?? 0,
      images: row.images ?? 0,
      bytes: row.bytes,
    }
  }

  prune({ maxItems, maxDays }: { maxItems: number; maxDays: number }): number {
    let removed = 0
    const tx = this.db.transaction(() => {
      if (maxDays > 0) {
        removed += this.db
          .prepare('DELETE FROM items WHERE pinned = 0 AND last_used_at < ?')
          .run(Date.now() - maxDays * 86_400_000).changes
      }
      if (maxItems > 0) {
        removed += this.db
          .prepare(
            `DELETE FROM items WHERE pinned = 0 AND id NOT IN (
               SELECT id FROM items WHERE pinned = 0 ORDER BY last_used_at DESC LIMIT ?
             )`,
          )
          .run(maxItems).changes
      }
      this.db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM item_tags)').run()
    })
    tx()
    if (removed > 0) this.gcOrphanBlobs()
    return removed
  }

  referencedBlobs(): Set<string> {
    const rows = this.db
      .prepare('SELECT DISTINCT blob_name AS n FROM items WHERE blob_name IS NOT NULL')
      .all() as { n: string }[]
    return new Set(rows.map((r) => r.n))
  }

  /** 单个 blob：确认没人再引用才删（同一张图可能被多条记录共用） */
  private gcBlob(name: string): void {
    const still = this.db.prepare('SELECT 1 FROM items WHERE blob_name = ? LIMIT 1').get(name)
    if (!still) blobs.drop(name)
  }

  gcOrphanBlobs(): number {
    const referenced = this.referencedBlobs()
    let dropped = 0
    for (const hash of blobs.listAll()) {
      if (!referenced.has(hash)) {
        blobs.drop(hash)
        dropped++
      }
    }
    return dropped
  }

  close(): void {
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)')
      this.db.close()
    } catch (err) {
      console.error('[db] 关闭异常', err)
    }
  }
}
