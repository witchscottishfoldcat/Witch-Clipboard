import { Search, X, Settings as SettingsIcon, Clipboard } from 'lucide-react'
import type { RefObject } from 'react'
import type { Stats } from '@shared/types'
import { formatBytes } from '@/lib/format'

interface Props {
  value: string
  onChange: (v: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  stats: Stats | null
  onClose: () => void
  onOpenSettings: () => void
}

export function Header({ value, onChange, inputRef, stats, onClose, onOpenSettings }: Props) {
  return (
    <div className="drag-region flex items-center gap-3 px-3.5 pt-3 pb-2.5">
      <div className="no-drag flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-brand-500 to-fuchsia-500 shadow-lg shadow-brand-500/25">
        <Clipboard className="size-4 text-white" strokeWidth={2.4} />
      </div>

      <div className="no-drag group relative flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-black/35 dark:text-white/35" />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="搜索剪贴板历史…"
          spellCheck={false}
          autoComplete="off"
          className="h-9 w-full rounded-[10px] border border-black/8 bg-white/60 pr-8 pl-9 text-[13px] text-black/85 outline-none transition placeholder:text-black/30 focus:border-brand-500/60 focus:bg-white/85 focus:ring-3 focus:ring-brand-500/12 dark:border-white/10 dark:bg-white/6 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:bg-white/10"
        />
        {value && (
          <button
            onClick={() => onChange('')}
            title="清空搜索 (Esc)"
            className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-black/40 transition hover:bg-black/8 hover:text-black/70 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/80"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {stats && (
        <div className="no-drag hidden shrink-0 items-center gap-1.5 text-[11px] text-black/40 tabular-nums sm:flex dark:text-white/40">
          <span>{stats.total} 条</span>
          <span className="text-black/20 dark:text-white/20">·</span>
          <span>{formatBytes(stats.bytes)}</span>
        </div>
      )}

      <div className="no-drag flex shrink-0 items-center gap-1">
        <button
          onClick={onOpenSettings}
          title="设置"
          className="flex size-7 items-center justify-center rounded-lg text-black/45 transition hover:bg-black/8 hover:text-black/75 dark:text-white/45 dark:hover:bg-white/10 dark:hover:text-white/85"
        >
          <SettingsIcon className="size-4" />
        </button>
        <button
          onClick={onClose}
          title="收起面板 (Esc)"
          className="flex size-7 items-center justify-center rounded-lg text-black/45 transition hover:bg-red-500/85 hover:text-white dark:text-white/45"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
