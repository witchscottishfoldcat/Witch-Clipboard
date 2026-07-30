import Database from 'better-sqlite3-multiple-ciphers'
import { app, dialog } from 'electron'
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { dbKeyHex } from './crypto'
import { classify } from '@shared/classify'

export type Db = Database.Database

const SCHEMA_VERSION = 3

const SCHEMA = `
CREATE TABLE items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT    NOT NULL,
  text         TEXT,
  preview      TEXT    NOT NULL DEFAULT '',
  auto_kind    TEXT    NOT NULL DEFAULT 'plain',
  hash         TEXT    NOT NULL UNIQUE,
  blob_name    TEXT,
  thumb        BLOB,
  width        INTEGER,
  height       INTEGER,
  bytes        INTEGER NOT NULL DEFAULT 0,
  source_app   TEXT,
  pinned       INTEGER NOT NULL DEFAULT 0,
  use_count    INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE INDEX idx_items_order ON items(pinned DESC, last_used_at DESC);
CREATE INDEX idx_items_kind  ON items(kind);
CREATE INDEX idx_items_auto_kind ON items(auto_kind);

CREATE TABLE tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE item_tags (
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);
CREATE INDEX idx_item_tags_tag ON item_tags(tag_id);

-- trigram 分词器能命中中文子串；默认的 unicode61 切不开 CJK
CREATE VIRTUAL TABLE items_fts USING fts5(
  text, preview, content='items', content_rowid='id', tokenize='trigram'
);

CREATE TRIGGER items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, text, preview) VALUES (new.id, new.text, new.preview);
END;
CREATE TRIGGER items_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, text, preview)
    VALUES ('delete', old.id, old.text, old.preview);
END;
CREATE TRIGGER items_au AFTER UPDATE OF text, preview ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, text, preview)
    VALUES ('delete', old.id, old.text, old.preview);
  INSERT INTO items_fts(rowid, text, preview) VALUES (new.id, new.text, new.preview);
END;
`

export function dbPath(): string {
  return join(app.getPath('userData'), 'clipboard.db')
}

function openEncrypted(file: string): Db {
  const db = new Database(file) as Db
  // key 必须是打开后的第一条语句
  db.pragma(`key="x'${dbKeyHex()}'"`)
  // 触发一次真实读取，密钥不对会在这里抛
  db.prepare('SELECT count(*) FROM sqlite_master').get()
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  return db
}

/**
 * 打开数据库。
 * 密钥丢失（换机器 / 换用户账户 / master.key 被删）时旧库无法解密，
 * 这时不静默丢数据，而是让用户决定：重建一个新库，还是退出自己去恢复 master.key。
 */
export function openDb(): Db {
  const file = dbPath()
  try {
    const db = openEncrypted(file)
    migrate(db)
    return db
  } catch (err) {
    const message = (err as Error).message
    console.error('[db] 打开失败：', message)
    if (!existsSync(file)) throw err

    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: 'WitchCat 粘贴板无法打开数据库',
      message: '现有的剪贴板数据库无法解密。',
      detail:
        `原因：${message}\n\n` +
        '通常是 master.key 丢失或换了 Windows 用户账户。原库会被改名保留成 ' +
        'clipboard.db.locked-<时间戳>，不会删除。',
      buttons: ['重建一个新数据库', '退出'],
      defaultId: 0,
      cancelId: 1,
    })
    if (choice !== 0) {
      app.exit(1)
      throw err
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    for (const suffix of ['', '-wal', '-shm']) {
      const from = file + suffix
      if (existsSync(from)) renameSync(from, `${file}.locked-${stamp}${suffix}`)
    }
    const db = openEncrypted(file)
    migrate(db)
    return db
  }
}

function migrate(db: Db): void {
  const current = Number((db.pragma('user_version', { simple: true }) as number) ?? 0)
  if (current >= SCHEMA_VERSION) return

  if (current === 0) {
    db.exec('BEGIN')
    try {
      db.exec(SCHEMA)
      db.pragma(`user_version = ${SCHEMA_VERSION}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
  if (current < 2) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_items_auto_kind ON items(auto_kind)')
    db.pragma('user_version = 2')
  }
  if (current < 3) {
    const rows = db
      .prepare("SELECT id, text FROM items WHERE kind = 'text' AND auto_kind = 'plain'")
      .all() as { id: number; text: string | null }[]
    const update = db.prepare("UPDATE items SET auto_kind = 'key' WHERE id = ?")
    const backfill = db.transaction(() => {
      for (const row of rows) {
        if (row.text && classify(row.text) === 'key') update.run(row.id)
      }
    })
    backfill()
    db.pragma('user_version = 3')
  }
}
