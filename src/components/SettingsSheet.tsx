import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import {
  X,
  Monitor,
  Sun,
  Moon,
  Trash2,
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  FolderOpen,
  Rocket,
  EyeOff,
  ClipboardPaste,
  PanelTop,
} from 'lucide-react'
import type { SecurityInfo, Settings } from '@shared/types'
import { api } from '@/lib/api'
import { UpdateSection } from './UpdateSection'

interface Props {
  onClose: () => void
  onCleared: () => void
  onToast: (text: string, tone?: 'ok' | 'warn') => void
}

const THEMES: [Settings['theme'], string, typeof Monitor][] = [
  ['system', '跟随系统', Monitor],
  ['light', '浅色', Sun],
  ['dark', '深色', Moon],
]

const ITEM_LIMITS = [500, 2000, 10000, 0]
const DAY_LIMITS = [7, 30, 90, 0]

const label = (v: number, unit: string): string => (v === 0 ? '不限' : `${v} ${unit}`)

/** 把按键事件转成 Electron accelerator，例如 Alt+Shift+V */
function toAccelerator(e: KeyboardEvent): string | null {
  const key = e.key
  if (['Control', 'Alt', 'Shift', 'Meta', 'Dead'].includes(key)) return null

  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Super')
  // 至少要有一个修饰键，否则会抢掉普通打字
  if (parts.length === 0) return null

  const named: Record<string, string> = {
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Escape: 'Esc',
    Enter: 'Return',
    Backquote: '`',
  }
  const main = named[key] ?? (key.length === 1 ? key.toUpperCase() : key)
  parts.push(main)
  return parts.join('+')
}

export function SettingsSheet({ onClose, onCleared, onToast }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [security, setSecurity] = useState<SecurityInfo | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const hotkeyBox = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    void api.getSettings().then(setSettings)
    void api.security().then(setSecurity)
  }, [])

  const patch = async (p: Partial<Settings>): Promise<Settings> => {
    const next = await api.saveSettings(p)
    setSettings(next)
    if (p.theme) {
      const resolved =
        p.theme === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : p.theme
      document.documentElement.dataset['theme'] = resolved
    }
    return next
  }

  // 热键录制：捕获阶段拦下按键，别让 App 的全局快捷键先处理掉
  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturing(false)
        return
      }
      const accel = toAccelerator(e)
      if (!accel) return
      setCapturing(false)
      void patch({ hotkey: accel }).then((next) => {
        onToast(
          next.hotkey === accel ? `热键已改为 ${accel}` : '热键设置失败',
          next.hotkey === accel ? 'ok' : 'warn',
        )
      })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing]) // eslint-disable-line react-hooks/exhaustive-deps

  const rowClass =
    'flex h-8 items-center gap-2 rounded-lg bg-black/5 px-2.5 text-[12px] text-black/70 dark:bg-white/8 dark:text-white/70'
  const segBtn = (active: boolean): string =>
    `h-7 flex-1 rounded-md text-[11.5px] tabular-nums transition ${
      active
        ? 'bg-brand-500 text-white shadow-sm shadow-brand-500/30'
        : 'text-black/55 hover:bg-black/8 dark:text-white/55 dark:hover:bg-white/10'
    }`

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14 }}
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/25 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.97, y: 4 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92%] w-[400px] flex-col overflow-hidden rounded-2xl border border-black/8 bg-white/94 shadow-2xl backdrop-blur-xl dark:border-white/12 dark:bg-[#16161f]/94"
      >
        <div className="flex shrink-0 items-center justify-between px-4 pt-3.5 pb-2">
          <span className="text-[13px] font-semibold text-black/80 dark:text-white/85">设置</span>
          <button
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded-md text-black/40 transition hover:bg-black/8 dark:text-white/40 dark:hover:bg-white/10"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          {/* 外观 */}
          <section>
            <div className="mb-1.5 text-[11px] text-black/45 dark:text-white/45">外观</div>
            <div className="flex gap-1.5">
              {THEMES.map(([value, text, Icon]) => (
                <button
                  key={value}
                  onClick={() => void patch({ theme: value })}
                  className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-[11.5px] transition ${
                    settings?.theme === value
                      ? 'bg-brand-500 text-white shadow-sm shadow-brand-500/30'
                      : 'bg-black/5 text-black/60 hover:bg-black/10 dark:bg-white/8 dark:text-white/60 dark:hover:bg-white/14'
                  }`}
                >
                  <Icon className="size-3.5" />
                  {text}
                </button>
              ))}
            </div>
          </section>

          {/* 热键 */}
          <section>
            <div className="mb-1.5 text-[11px] text-black/45 dark:text-white/45">唤出热键</div>
            <button
              ref={hotkeyBox}
              onClick={() => setCapturing(true)}
              className={`${rowClass} w-full transition ${
                capturing
                  ? 'ring-2 ring-brand-500/60'
                  : 'hover:bg-black/8 dark:hover:bg-white/12'
              }`}
            >
              <KeyRound className="size-3.5 opacity-60" />
              {capturing ? (
                <span className="text-brand-600 dark:text-brand-400">按下新的组合键…（Esc 取消）</span>
              ) : (
                <>
                  <kbd className="font-sans">{settings?.hotkey ?? 'Alt+V'}</kbd>
                  <span className="ml-auto text-[10.5px] text-black/35 dark:text-white/35">
                    点击修改
                  </span>
                </>
              )}
            </button>
          </section>

          {/* 行为 */}
          <section className="space-y-1.5">
            <div className="text-[11px] text-black/45 dark:text-white/45">行为</div>
            {(
              [
                ['trayOpensMini', '单击托盘弹迷你预览面板', PanelTop],
                ['hideAfterPaste', '粘贴后收起面板', ClipboardPaste],
                ['skipSensitive', '跳过密码管理器的复制', EyeOff],
                ['autoLaunch', '开机自启（静默驻托盘）', Rocket],
              ] as const
            ).map(([key, text, Icon]) => (
              <label key={key} className={`${rowClass} cursor-pointer`}>
                <Icon className="size-3.5 opacity-60" />
                {text}
                <input
                  type="checkbox"
                  checked={Boolean(settings?.[key])}
                  onChange={(e) => void patch({ [key]: e.target.checked })}
                  className="ml-auto size-3.5 accent-[var(--color-brand-500)]"
                />
              </label>
            ))}
          </section>

          {/* 保留策略 */}
          <section className="space-y-2">
            <div className="text-[11px] text-black/45 dark:text-white/45">保留策略</div>
            <div>
              <div className="mb-1 text-[10.5px] text-black/40 dark:text-white/40">最多条数</div>
              <div className="flex gap-0.5 rounded-lg bg-black/5 p-0.5 dark:bg-white/8">
                {ITEM_LIMITS.map((v) => (
                  <button
                    key={v}
                    onClick={() => void patch({ maxItems: v })}
                    className={segBtn(settings?.maxItems === v)}
                  >
                    {label(v, '条')}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 text-[10.5px] text-black/40 dark:text-white/40">最多保留</div>
              <div className="flex gap-0.5 rounded-lg bg-black/5 p-0.5 dark:bg-white/8">
                {DAY_LIMITS.map((v) => (
                  <button
                    key={v}
                    onClick={() => void patch({ maxDays: v })}
                    className={segBtn(settings?.maxDays === v)}
                  >
                    {label(v, '天')}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-[10.5px] leading-4 text-black/35 dark:text-white/35">
              置顶的条目不受保留策略影响，永远不会被自动清理。
            </div>
          </section>

          {/* 数据 */}
          <section className="space-y-1.5">
            <div className="text-[11px] text-black/45 dark:text-white/45">数据</div>
            <button onClick={() => void api.openDataDir()} className={`${rowClass} w-full`}>
              <FolderOpen className="size-3.5 opacity-60" />
              打开数据目录
              <span className="ml-auto max-w-[190px] truncate text-[10px] text-black/30 dark:text-white/30">
                {security?.dataDir}
              </span>
            </button>
            <button
              onClick={() => {
                if (!confirmClear) {
                  setConfirmClear(true)
                  return
                }
                void api.clearAll().then(() => {
                  setConfirmClear(false)
                  onToast('历史已清空（置顶保留）')
                  onCleared()
                })
              }}
              className={`flex h-8 w-full items-center justify-center gap-1.5 rounded-lg text-[11.5px] transition ${
                confirmClear
                  ? 'bg-red-500 text-white hover:bg-red-600'
                  : 'bg-black/5 text-black/60 hover:bg-black/10 dark:bg-white/8 dark:text-white/60 dark:hover:bg-white/14'
              }`}
            >
              <Trash2 className="size-3.5" />
              {confirmClear ? '确认清空？（置顶条目会保留）' : '清空历史记录'}
            </button>
          </section>

          <UpdateSection onToast={onToast} />

          {/* 安全状态 */}
          {security && (
            <section className="space-y-1.5">
              <div className="text-[11px] text-black/45 dark:text-white/45">安全</div>
              {[
                {
                  ok: security.dbEncrypted,
                  text: security.dbEncrypted
                    ? '数据库已加密（SQLCipher）'
                    : '降级到内存存储，重启会丢数据',
                },
                {
                  ok: security.osProtected,
                  text: security.osProtected
                    ? '主密钥由 Windows DPAPI 保护'
                    : '主密钥以明文保存（系统未提供加密能力）',
                },
                {
                  ok: security.nativeAvailable,
                  text: security.nativeAvailable
                    ? '原生能力可用：自动粘贴、敏感剪贴板识别'
                    : '原生能力不可用，只能手动 Ctrl+V',
                },
              ].map((row, i) => (
                <div
                  key={i}
                  className="flex items-start gap-1.5 text-[10.5px] leading-4 text-black/50 dark:text-white/50"
                >
                  {row.ok ? (
                    <ShieldCheck className="mt-px size-3 shrink-0 text-emerald-500" />
                  ) : (
                    <ShieldAlert className="mt-px size-3 shrink-0 text-amber-500" />
                  )}
                  <span>{row.text}</span>
                </div>
              ))}
            </section>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
