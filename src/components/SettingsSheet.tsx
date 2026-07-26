import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { X, Monitor, Sun, Moon, Trash2, KeyRound, Info } from 'lucide-react'
import type { Settings } from '@shared/types'
import { api } from '@/lib/api'

interface Props {
  onClose: () => void
  onCleared: () => void
}

const THEMES: [Settings['theme'], string, typeof Monitor][] = [
  ['system', '跟随系统', Monitor],
  ['light', '浅色', Sun],
  ['dark', '深色', Moon],
]

export function SettingsSheet({ onClose, onCleared }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    void api.getSettings().then(setSettings)
  }, [])

  const patch = async (p: Partial<Settings>): Promise<void> => {
    setSettings(await api.saveSettings(p))
    // 主题写入 <html>，立即生效
    if (p.theme) {
      const resolved =
        p.theme === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : p.theme
      document.documentElement.dataset['theme'] = resolved
    }
  }

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
        className="w-[360px] overflow-hidden rounded-2xl border border-black/8 bg-white/92 shadow-2xl backdrop-blur-xl dark:border-white/12 dark:bg-[#16161f]/92"
      >
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
          <span className="text-[13px] font-semibold text-black/80 dark:text-white/85">设置</span>
          <button
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded-md text-black/40 transition hover:bg-black/8 dark:text-white/40 dark:hover:bg-white/10"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="space-y-4 px-4 pb-4">
          {/* 主题 */}
          <div>
            <div className="mb-1.5 text-[11px] text-black/45 dark:text-white/45">外观</div>
            <div className="flex gap-1.5">
              {THEMES.map(([value, label, Icon]) => (
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
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 热键 */}
          <div>
            <div className="mb-1.5 text-[11px] text-black/45 dark:text-white/45">唤出热键</div>
            <div className="flex h-8 items-center gap-2 rounded-lg bg-black/5 px-2.5 text-[12px] text-black/70 dark:bg-white/8 dark:text-white/70">
              <KeyRound className="size-3.5 opacity-60" />
              <kbd className="font-sans">{settings?.hotkey ?? 'Alt+V'}</kbd>
              <span className="ml-auto text-[10.5px] text-black/35 dark:text-white/35">
                自定义在 P4
              </span>
            </div>
          </div>

          {/* 清空 */}
          <div>
            <div className="mb-1.5 text-[11px] text-black/45 dark:text-white/45">数据</div>
            <button
              onClick={() => {
                if (!confirmClear) {
                  setConfirmClear(true)
                  return
                }
                void api.clearAll().then(() => {
                  setConfirmClear(false)
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
          </div>

          <div className="flex items-start gap-1.5 rounded-lg bg-brand-500/8 px-2.5 py-2 text-[10.5px] leading-4 text-black/50 dark:text-white/50">
            <Info className="mt-px size-3 shrink-0 text-brand-500" />
            <span>
              当前是 P0 骨架：数据在内存里，重启会重置。SQLite 持久化、保留策略与加密在 P1 / P4 接入。
            </span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
