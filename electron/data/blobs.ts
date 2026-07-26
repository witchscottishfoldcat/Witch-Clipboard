/**
 * 图片仓库：内容寻址 + 加密落盘。
 * 路径 blobs/<hash 前 2 位>/<hash>.bin，同一张图只存一份，天然去重。
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { openBuffer, sealBuffer } from './crypto'

function root(): string {
  return join(app.getPath('userData'), 'blobs')
}

function pathOf(hash: string): string {
  return join(root(), hash.slice(0, 2), `${hash}.bin`)
}

/** 写入（已存在则跳过）；返回相对名，存进数据库 */
export function put(hash: string, plain: Buffer): string {
  const file = pathOf(hash)
  if (!existsSync(file)) {
    mkdirSync(join(root(), hash.slice(0, 2)), { recursive: true })
    writeFileSync(file, sealBuffer(plain))
  }
  return hash
}

export function get(hash: string): Buffer | null {
  const file = pathOf(hash)
  if (!existsSync(file)) return null
  try {
    return openBuffer(readFileSync(file))
  } catch (err) {
    console.error(`[blobs] 解密失败 ${hash}:`, (err as Error).message)
    return null
  }
}

export function drop(hash: string): void {
  try {
    unlinkSync(pathOf(hash))
  } catch {
    /* 本来就没有，忽略 */
  }
}

/** 列出所有已落盘的 hash，用于回收没人引用的孤儿文件 */
export function listAll(): string[] {
  const dir = root()
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const shard of readdirSync(dir, { withFileTypes: true })) {
    if (!shard.isDirectory()) continue
    for (const f of readdirSync(join(dir, shard.name))) {
      if (f.endsWith('.bin')) out.push(f.slice(0, -4))
    }
  }
  return out
}
