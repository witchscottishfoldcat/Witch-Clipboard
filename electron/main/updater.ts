/**
 * 自动更新：以 GitHub Releases 为源。
 *
 * 两条硬规矩：
 * 1. 绝不自动下载、绝不自动装。`autoDownload = false`，一切都要用户点。
 * 2. 用户选了「暂不更新」就记住这个版本号，下次启动不再提示同一个版本——
 *    每次开机都弹一遍才是真正让人关掉更新的原因。
 */
import { app, BrowserWindow } from 'electron'
import { appendFileSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateStatus } from '@shared/types'
import { getSettings, saveSettings } from './settings'

/** 启动后延迟一会儿再查，别和采集、建库抢启动那几秒 */
const STARTUP_DELAY_MS = 12_000

type Updater = typeof import('electron-updater').autoUpdater

let updater: Updater | null = null
let status: UpdateStatus = { state: 'idle', currentVersion: app.getVersion() }

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('update:status', status)
}

function setStatus(patch: Partial<UpdateStatus>): UpdateStatus {
  status = { ...status, ...patch, currentVersion: app.getVersion() }
  broadcast()
  return status
}

/** 开发模式下没有 app-update.yml，直接调用会抛；用这个环境变量可以假造一次更新来试界面 */
function fakeVersion(): string | null {
  return app.isPackaged ? null : (process.env['WCC_FAKE_UPDATE'] ?? null)
}

/** 日志上限，超了就从头写；不做轮转，够查问题就行 */
const LOG_MAX_BYTES = 256 * 1024

export function updateLogPath(): string {
  return join(app.getPath('userData'), 'update.log')
}

/**
 * 更新检查全程写日志到数据目录。
 * 打包后的应用没有控制台，出了问题（没网、被墙、GitHub 抽风）用户和维护者
 * 都没法查，只能靠这个文件。
 */
function write(level: string, message: unknown): void {
  try {
    const file = updateLogPath()
    if (existsSync(file) && statSync(file).size > LOG_MAX_BYTES) writeFileSync(file, '')
    appendFileSync(file, `${new Date().toISOString()} [${level}] ${String(message)}\n`, 'utf8')
  } catch {
    /* 日志写不了不能影响更新本身 */
  }
}

function fileLogger(): {
  info: (m: unknown) => void
  warn: (m: unknown) => void
  error: (m: unknown) => void
  debug: (m: unknown) => void
} {
  return {
    info: (m) => write('info', m),
    warn: (m) => write('warn', m),
    error: (m) => write('error', m),
    debug: () => {},
  }
}

async function getUpdater(): Promise<Updater | null> {
  if (updater) return updater
  try {
    // electron-updater 是 CJS：打包成 CJS 之后动态 import 拿到的命名空间会把导出
    // 包进 default，mod.autoUpdater 直接是 undefined。两种形状都要认。
    const mod = (await import('electron-updater')) as unknown as {
      autoUpdater?: Updater
      default?: { autoUpdater?: Updater }
    }
    const resolved = mod.autoUpdater ?? mod.default?.autoUpdater
    if (!resolved) throw new Error('electron-updater 里找不到 autoUpdater 导出')
    updater = resolved
    updater.autoDownload = false // 必须用户点了才下
    updater.autoInstallOnAppQuit = false // 也不在退出时偷偷装
    updater.logger = fileLogger()
    updater.logger.info(`当前版本 ${app.getVersion()}，更新日志：${updateLogPath()}`)

    updater.on('update-available', (info) => {
      setStatus({ state: 'available', version: info.version, notes: releaseNotes(info) })
    })
    updater.on('update-not-available', () => setStatus({ state: 'none', version: undefined }))
    updater.on('download-progress', (p) =>
      setStatus({ state: 'downloading', percent: Math.round(p.percent) }),
    )
    updater.on('update-downloaded', (info) =>
      setStatus({ state: 'ready', version: info.version, percent: 100 }),
    )
    updater.on('error', (err) =>
      setStatus({ state: 'error', error: err?.message ?? String(err) }),
    )

    return updater
  } catch (err) {
    // 这条以前只 console.error，打包后没有控制台，等于完全不可见
    write('error', `加载 electron-updater 失败：${(err as Error).stack ?? err}`)
    setStatus({ state: 'error', error: (err as Error).message })
    return null
  }
}

function releaseNotes(info: { releaseNotes?: string | { note: string | null }[] | null }): string {
  const raw = info.releaseNotes
  if (!raw) return ''
  const text = typeof raw === 'string' ? raw : raw.map((n) => n.note ?? '').join('\n')
  // 发布说明可能很长，界面上只放得下开头一段
  return text.replace(/<[^>]+>/g, '').trim().slice(0, 600)
}

/**
 * 查一次更新。
 * @param silent 启动时的自动检查：查不到、出错都不打扰用户，且尊重「暂不更新」记住的版本
 *
 * 注意「有没有新版本」和「要不要提示用户」是两件事，判断只放在这一个地方——
 * 早先假更新那条路径绕过了跳过判断，等于跳过逻辑只在真实路径里生效。
 */
export async function checkForUpdate(silent = false): Promise<UpdateStatus> {
  const faked = fakeVersion()

  let version: string | undefined
  let notes = ''

  if (faked) {
    version = faked
    notes = '（WCC_FAKE_UPDATE 造出来的假更新，用于试界面）'
  } else {
    if (!app.isPackaged) {
      return setStatus({ state: 'unsupported', error: '开发模式下不检查更新' })
    }
    const up = await getUpdater()
    if (!up) return status

    setStatus({ state: 'checking', error: undefined })
    try {
      const result = await up.checkForUpdates()
      version = result?.updateInfo?.version
      if (result?.updateInfo) notes = releaseNotes(result.updateInfo)
    } catch (err) {
      const message = (err as Error).message ?? String(err)
      console.error('[updater] 检查更新失败：', message)
      // 自动检查失败（没网、GitHub 抽风）不该弹任何东西出来
      return setStatus(silent ? { state: 'idle' } : { state: 'error', error: message })
    }
  }

  if (!version || version === app.getVersion()) return setStatus({ state: 'none' })

  // 用户说过这个版本先不更新，启动时的自动检查就别再提；手动点「检查更新」还是要如实告诉他
  if (silent && getSettings().skippedVersion === version) {
    return setStatus({ state: 'idle', version })
  }

  return setStatus({ state: 'available', version, notes })
}

/** 用户点了「下载更新」才会走到这里 */
export async function downloadUpdate(): Promise<UpdateStatus> {
  if (fakeVersion()) return setStatus({ state: 'ready', percent: 100 })

  const up = await getUpdater()
  if (!up) return status

  setStatus({ state: 'downloading', percent: 0, error: undefined })
  try {
    await up.downloadUpdate()
    return status
  } catch (err) {
    return setStatus({ state: 'error', error: (err as Error).message })
  }
}

/** 用户点了「重启并安装」 */
export function installUpdate(): void {
  if (fakeVersion()) {
    console.log('[updater] 假更新，不真的重启')
    return
  }
  if (!updater || status.state !== 'ready') return
  // 第二个参数 true：装完自动把应用拉起来
  updater.quitAndInstall(false, true)
}

/** 用户点了「暂不更新」：记住版本号，下次启动不再提示它 */
export function skipVersion(version?: string): UpdateStatus {
  const target = version ?? status.version
  if (target) saveSettings({ skippedVersion: target })
  return setStatus({ state: 'idle' })
}

export function currentStatus(): UpdateStatus {
  return status
}

/** 启动后自动查一次；失败、无更新、以及被跳过的版本都不会打扰用户 */
export function scheduleStartupCheck(): void {
  if (!app.isPackaged && !fakeVersion()) return
  write('info', `${STARTUP_DELAY_MS / 1000} 秒后自动检查一次更新（当前 ${app.getVersion()}）`)
  setTimeout(() => {
    write('info', '开始自动检查更新')
    void checkForUpdate(true).then((s) =>
      write('info', `自动检查结果：state=${s.state} version=${s.version ?? '-'} ${s.error ?? ''}`),
    )
  }, STARTUP_DELAY_MS)
}
