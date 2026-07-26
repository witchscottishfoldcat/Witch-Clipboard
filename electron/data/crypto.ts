/**
 * 密钥与 blob 加密。
 * 主密钥 32 字节随机，用 Electron safeStorage（Windows 上是 DPAPI，绑定当前用户账户）保护后落盘。
 * 数据库和图片各自派生一把子密钥，避免同一把 key 复用在两种用途上。
 */
import { app, safeStorage } from 'electron'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const MAGIC_KEYFILE = 'ZTBK'
const MAGIC_BLOB = 'ZTB1'
const IV_LEN = 12
const TAG_LEN = 16

let master: Buffer | null = null
let protectedByOs = false

function keyFile(): string {
  return join(app.getPath('userData'), 'master.key')
}

/** 首次调用会生成并保存主密钥；必须在 app ready 之后调用 */
export function masterKey(): Buffer {
  if (master) return master

  const file = keyFile()
  if (existsSync(file)) {
    const raw = readFileSync(file)
    if (raw.subarray(0, 4).toString('ascii') === MAGIC_KEYFILE) {
      master = Buffer.from(safeStorage.decryptString(raw.subarray(4)), 'base64')
      protectedByOs = true
    } else {
      // 明文回退格式（系统没有提供加密能力时写的）
      master = Buffer.from(raw.toString('utf8').trim(), 'base64')
      protectedByOs = false
    }
    if (master.length !== 32) throw new Error('主密钥长度异常，文件可能损坏')
    return master
  }

  master = randomBytes(32)
  mkdirSync(app.getPath('userData'), { recursive: true })

  if (safeStorage.isEncryptionAvailable()) {
    const sealed = safeStorage.encryptString(master.toString('base64'))
    writeFileSync(file, Buffer.concat([Buffer.from(MAGIC_KEYFILE, 'ascii'), sealed]))
    protectedByOs = true
  } else {
    // 这种情况下密钥是明文的，加密只能防「直接打开 db 文件看内容」，防不住能读到这台机器文件的人
    console.warn('[crypto] 系统未提供 safeStorage，主密钥将以明文保存')
    writeFileSync(file, master.toString('base64'), 'utf8')
    protectedByOs = false
  }
  return master
}

/** 主密钥是否受操作系统保护（Windows DPAPI） */
export function isOsProtected(): boolean {
  if (!master) masterKey()
  return protectedByOs
}

function subKey(purpose: string): Buffer {
  return createHash('sha256').update(masterKey()).update(purpose).digest()
}

/** SQLCipher 用的 hex 密钥 */
export function dbKeyHex(): string {
  return subKey('sqlcipher').toString('hex')
}

/** 加密图片等二进制：ZTB1 | iv(12) | tag(16) | ciphertext */
export function sealBuffer(plain: Buffer): Buffer {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', subKey('blob'), iv)
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([Buffer.from(MAGIC_BLOB, 'ascii'), iv, cipher.getAuthTag(), body])
}

export function openBuffer(sealed: Buffer): Buffer {
  if (sealed.subarray(0, 4).toString('ascii') !== MAGIC_BLOB) {
    throw new Error('blob 头部不匹配，文件不是 ZTB 加密格式')
  }
  const iv = sealed.subarray(4, 4 + IV_LEN)
  const tag = sealed.subarray(4 + IV_LEN, 4 + IV_LEN + TAG_LEN)
  const body = sealed.subarray(4 + IV_LEN + TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', subKey('blob'), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()])
}

export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}
