/**
 * 数据目录。
 *
 * Electron 默认的 userData 路径来自应用名：开发时是 package.json 的 name，
 * 打包后是 electron-builder 的 productName。这两个值一旦不一致，开发版和正式版
 * 就会读到两个不同的数据库。所以这里固定一个规范目录，两边都用它。
 */
import { app } from 'electron'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

// 改项目名后仍沿用旧目录，避免用户历史记录和加密密钥“消失”。
const DATA_DIR = 'WitchCat-Clipboard'

/** 改名前用过的目录名（旧版叫 ZTB） */
const LEGACY_DIRS = ['ztb', 'ZTB']

/** 迁移完成的标记，同时留给用户看清楚数据是从哪搬来的 */
const STAMP = 'migrated-from-ztb.txt'

/** 旧文件名 → 新文件名 */
const RENAMES: Record<string, string> = {
  'ztb.db': 'clipboard.db',
  'ztb.db-wal': 'clipboard.db-wal',
  'ztb.db-shm': 'clipboard.db-shm',
}

/** 只搬我们自己的数据，不动 Electron 自己生成的缓存目录 */
const OWN_FILES = ['master.key', 'settings.json', 'blobs', ...Object.keys(RENAMES)]

/**
 * safeStorage 在 Windows 上的密钥并不只绑用户账户：它存在 profile 的 Local State 里
 * （再由 DPAPI 保护）。换数据目录就等于换了一把随机密钥，旧的 master.key 会解不开。
 * 所以迁移时必须把这个文件一起带过来。
 */
const PROFILE_FILES = ['Local State']

export function useCanonicalUserData(): void {
  app.setPath('userData', join(app.getPath('appData'), DATA_DIR))
}

/**
 * 从旧目录搬一次数据，只执行一次（靠标记文件判断）。
 * 任何一步失败都只记日志、不删任何东西——最坏情况是用户从一个空库开始，
 * 旧数据还完整躺在旧目录里。
 */
export function migrateLegacyData(): void {
  try {
    const target = app.getPath('userData')
    if (existsSync(join(target, STAMP))) return

    const appData = app.getPath('appData')
    const legacy = LEGACY_DIRS.map((name) => join(appData, name)).find(
      (dir) => dir.toLowerCase() !== target.toLowerCase() && existsSync(dir),
    )
    if (!legacy) return

    mkdirSync(target, { recursive: true })
    const done: string[] = []

    // Local State 要先搬，而且是复制+覆盖：新建的 profile 里那份是刚生成的随机密钥，
    // 留着它就解不开搬过来的 master.key。原文件留在旧目录不动。
    for (const name of PROFILE_FILES) {
      const from = join(legacy, name)
      if (!existsSync(from)) continue
      try {
        copyFileSync(from, join(target, name))
        done.push(`${name}（复制，safeStorage 的密钥在里面）`)
      } catch (err) {
        console.error(`[paths] 复制 ${name} 失败：`, (err as Error).message)
      }
    }

    for (const name of readdirSync(legacy)) {
      if (!OWN_FILES.includes(name)) continue
      const to = join(target, RENAMES[name] ?? name)
      if (existsSync(to)) continue
      try {
        renameSync(join(legacy, name), to)
        done.push(`${name} → ${RENAMES[name] ?? name}`)
      } catch (err) {
        console.error(`[paths] 搬迁 ${name} 失败：`, (err as Error).message)
      }
    }

    writeFileSync(
      join(target, STAMP),
      `数据迁移自：${legacy}\n时间：${new Date().toISOString()}\n\n${done.join('\n')}\n`,
      'utf8',
    )

    if (done.length > 0) console.log(`[paths] 已从旧目录迁移数据：${legacy}\n  ${done.join('\n  ')}`)
  } catch (err) {
    console.error('[paths] 迁移旧数据失败，将从空库开始：', err)
  }
}

/** 数据目录里我们自己的东西占了多少字节（出错返回 0） */
export function dataDirSize(): number {
  try {
    const dir = app.getPath('userData')
    let total = 0
    const walk = (path: string): void => {
      const s = statSync(path)
      if (s.isDirectory()) for (const name of readdirSync(path)) walk(join(path, name))
      else total += s.size
    }
    for (const name of OWN_FILES) {
      const path = join(dir, name)
      if (existsSync(path)) walk(path)
    }
    return total
  } catch {
    return 0
  }
}
