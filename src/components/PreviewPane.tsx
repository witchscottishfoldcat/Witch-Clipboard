import { useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ClipboardPaste, Copy, Pin, Trash2, Plus, X, Hash } from 'lucide-react'
import type { ClipItem } from '@shared/types'
import { badgeOf, colorValue } from '@/lib/kinds'
import { absoluteTime, formatBytes } from '@/lib/format'

interface Props {
  item: ClipItem | null
  onPaste: (id: number) => void
  onCopy: (id: number) => void
  onTogglePin: (id: number) => void
  onRemove: (id: number) => void
  onSetTags: (id: number, tags: string[]) => void
}

export function PreviewPane({ item, onPaste, onCopy, onTogglePin, onRemove, onSetTags }: Props) {
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)

  if (!item) {
    return (
      <div className="flex w-[300px] shrink-0 items-center justify-center border-l border-black/6 text-[12px] text-black/30 dark:border-white/8 dark:text-white/30">
        选中一条记录查看详情
      </div>
    )
  }

  const badge = badgeOf(item)
  const color = colorValue(item)
  const isCode = item.kind === 'text' && item.autoKind === 'code'

  const commitTag = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && draft.trim()) {
      onSetTags(item.id, [...item.tags, draft.trim()])
      setDraft('')
      setAdding(false)
    } else if (e.key === 'Escape') {
      setDraft('')
      setAdding(false)
      e.stopPropagation()
    }
  }

  return (
    <div className="flex w-[300px] shrink-0 flex-col border-l border-black/6 dark:border-white/8">
      <AnimatePresence mode="wait">
        <motion.div
          key={item.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* 元信息 */}
          <div className="flex items-center gap-1.5 px-3.5 pt-3 pb-2">
            <span
              className={`inline-flex h-5 items-center rounded px-1.5 text-[10px] font-semibold ${badge.chip}`}
            >
              {badge.label}
            </span>
            {item.pinned && (
              <Pin className="size-3 fill-brand-500 text-brand-500" strokeWidth={2} />
            )}
            <span className="ml-auto text-[10.5px] text-black/35 tabular-nums dark:text-white/35">
              {formatBytes(item.bytes)}
            </span>
          </div>

          {/* 内容 */}
          <div className="min-h-0 flex-1 overflow-y-auto px-3.5">
            {item.kind === 'image' && item.thumb ? (
              <div className="overflow-hidden rounded-xl border border-black/8 bg-[repeating-conic-gradient(#0000_0_25%,#8881_0_50%)] bg-[length:16px_16px] dark:border-white/10">
                <img src={item.thumb} alt="" draggable={false} className="w-full object-contain" />
              </div>
            ) : color ? (
              <div className="space-y-2">
                <div
                  className="h-24 w-full rounded-xl border border-black/10 dark:border-white/15"
                  style={{ background: color }}
                />
                <div className="selectable font-mono text-[12px] text-black/70 dark:text-white/70">
                  {item.text}
                </div>
              </div>
            ) : (
              <pre
                className={`selectable m-0 whitespace-pre-wrap break-words text-[12px] leading-[1.55] text-black/78 dark:text-white/78 ${
                  isCode ? 'font-mono' : 'font-sans'
                }`}
              >
                {item.text}
              </pre>
            )}
          </div>

          {/* 标签 */}
          <div className="flex flex-wrap items-center gap-1.5 px-3.5 pt-2.5">
            {item.tags.map((t) => (
              <span
                key={t}
                className="group inline-flex h-6 items-center gap-1 rounded-full bg-black/6 pr-1 pl-2 text-[11px] text-black/60 dark:bg-white/10 dark:text-white/60"
              >
                <Hash className="size-2.5 opacity-60" />
                {t}
                <button
                  onClick={() => onSetTags(item.id, item.tags.filter((x) => x !== t))}
                  className="flex size-4 items-center justify-center rounded-full text-black/35 transition hover:bg-black/10 hover:text-red-500 dark:text-white/35 dark:hover:bg-white/15"
                >
                  <X className="size-2.5" />
                </button>
              </span>
            ))}

            {adding ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={commitTag}
                onBlur={() => {
                  setDraft('')
                  setAdding(false)
                }}
                placeholder="标签名，回车确认"
                className="h-6 w-28 rounded-full border border-brand-500/50 bg-white/70 px-2 text-[11px] outline-none dark:bg-white/10 dark:text-white/85"
              />
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="inline-flex h-6 items-center gap-0.5 rounded-full border border-dashed border-black/15 px-2 text-[11px] text-black/40 transition hover:border-brand-500/50 hover:text-brand-600 dark:border-white/15 dark:text-white/40 dark:hover:text-brand-400"
              >
                <Plus className="size-3" />
                标签
              </button>
            )}
          </div>

          {/* 来源与时间 */}
          <div className="px-3.5 pt-2.5 text-[10.5px] leading-4 text-black/35 dark:text-white/35">
            <div>{absoluteTime(item.createdAt)} 复制</div>
            {item.sourceApp && <div>来自 {item.sourceApp}</div>}
            {item.useCount > 0 && <div>已使用 {item.useCount} 次</div>}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* 操作区 */}
      <div className="flex items-center gap-1.5 p-3">
        <button
          onClick={() => onPaste(item.id)}
          className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-500 text-[12px] font-medium text-white shadow-sm shadow-brand-500/30 transition hover:bg-brand-600 active:scale-[0.98]"
        >
          <ClipboardPaste className="size-3.5" />
          粘贴
        </button>
        {(
          [
            [Copy, '复制到剪贴板 (Ctrl+C)', () => onCopy(item.id), ''],
            [Pin, item.pinned ? '取消置顶 (Ctrl+P)' : '置顶 (Ctrl+P)', () => onTogglePin(item.id), ''],
            [Trash2, '删除 (Del)', () => onRemove(item.id), 'hover:bg-red-500/90 hover:text-white'],
          ] as const
        ).map(([Icon, title, action, extra], i) => (
          <button
            key={i}
            title={title}
            onClick={action}
            className={`flex size-8 items-center justify-center rounded-lg bg-black/5 text-black/55 transition hover:bg-black/10 hover:text-black/80 dark:bg-white/8 dark:text-white/55 dark:hover:bg-white/14 dark:hover:text-white/90 ${extra}`}
          >
            <Icon className="size-3.5" />
          </button>
        ))}
      </div>
    </div>
  )
}
