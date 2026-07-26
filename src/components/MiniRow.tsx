import { memo } from 'react'
import {
  Pin,
  Image as ImageIcon,
  Film,
  Music,
  FileArchive,
  FileText,
  FileCode,
  File as FileIcon,
  FolderOpen,
} from 'lucide-react'
import type { ClipItem } from '@shared/types'
import { badgeOf, colorValue } from '@/lib/kinds'
import { fileInfo, type FileInfo } from '@/lib/files'
import { formatBytes, relativeTime } from '@/lib/format'

interface Props {
  item: ClipItem
  selected: boolean
  hotIndex: number | null
  onSelect: () => void
  onPaste: () => void
  onReveal: () => void
}

const FILE_ICON: Record<FileInfo['kind'], typeof FileIcon> = {
  video: Film,
  audio: Music,
  image: ImageIcon,
  archive: FileArchive,
  doc: FileText,
  code: FileCode,
  other: FileIcon,
}

const FILE_TINT: Record<FileInfo['kind'], string> = {
  video: 'bg-rose-500/14 text-rose-500',
  audio: 'bg-amber-500/14 text-amber-500',
  image: 'bg-violet-500/14 text-violet-500',
  archive: 'bg-orange-500/14 text-orange-500',
  doc: 'bg-sky-500/14 text-sky-500',
  code: 'bg-emerald-500/14 text-emerald-500',
  other: 'bg-slate-500/14 text-slate-500',
}

export const MiniRow = memo(function MiniRow({
  item,
  selected,
  hotIndex,
  onSelect,
  onPaste,
  onReveal,
}: Props) {
  const badge = badgeOf(item)
  const color = colorValue(item)
  const files = fileInfo(item)
  const isCode = item.kind === 'text' && item.autoKind === 'code'

  return (
    <div
      onMouseDown={onSelect}
      onDoubleClick={onPaste}
      title={files ? files.paths.join('\n') : (item.text ?? '')}
      className={[
        'group relative flex cursor-default items-center gap-2.5 overflow-hidden rounded-lg px-2 py-1.5 transition-colors',
        selected
          ? 'bg-brand-500/14 ring-1 ring-brand-500/35'
          : 'hover:bg-black/5 dark:hover:bg-white/7',
      ].join(' ')}
    >
      {/* 左侧：缩略图 / 文件图标 / 色块 */}
      {item.kind === 'image' && item.thumb ? (
        <img
          src={item.thumb}
          alt=""
          draggable={false}
          className="size-9 shrink-0 rounded-md border border-black/8 object-cover dark:border-white/10"
        />
      ) : files ? (
        (() => {
          const Icon = FILE_ICON[files.kind]
          return (
            <div
              className={`flex size-9 shrink-0 items-center justify-center rounded-md ${FILE_TINT[files.kind]}`}
            >
              <Icon className="size-4.5" />
            </div>
          )
        })()
      ) : color ? (
        <div
          className="size-9 shrink-0 rounded-md border border-black/10 dark:border-white/15"
          style={{ background: color }}
        />
      ) : (
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-md text-[9px] font-semibold ${badge.chip}`}
        >
          {badge.label}
        </div>
      )}

      {/* 中间：内容 */}
      <div className="min-w-0 flex-1">
        <div
          className={[
            'truncate text-[12px] leading-4',
            isCode ? 'font-mono text-[11px]' : '',
            selected ? 'text-black/90 dark:text-white/90' : 'text-black/72 dark:text-white/75',
          ].join(' ')}
        >
          {files ? files.name : item.preview || '（空白内容）'}
        </div>

        {/* 文件：把完整路径摊出来，这是找视频/大文件时真正要看的东西 */}
        {files ? (
          <div className="truncate text-[10px] leading-4 text-black/38 dark:text-white/38">
            {files.paths.length > 1 ? `${files.paths.length} 个文件 · ` : ''}
            {item.bytes > 0 ? `${formatBytes(item.bytes)} · ` : ''}
            {files.dir || files.paths[0]}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[10px] leading-4 text-black/35 dark:text-white/35">
            <span>{relativeTime(item.lastUsedAt)}</span>
            {item.kind === 'image' && (
              <span>
                · {item.width}×{item.height}
              </span>
            )}
            {item.sourceApp && <span className="truncate">· {item.sourceApp}</span>}
          </div>
        )}
      </div>

      {/* 右侧：置顶标记 / 定位文件 / 快贴序号 */}
      {item.pinned && <Pin className="size-3 shrink-0 fill-brand-500 text-brand-500" />}

      {files && (
        <button
          onMouseDown={(e) => {
            e.stopPropagation()
            onReveal()
          }}
          title="在资源管理器中定位"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-black/35 opacity-0 transition group-hover:opacity-100 hover:bg-black/8 hover:text-black/70 dark:text-white/35 dark:hover:bg-white/12 dark:hover:text-white/80"
        >
          <FolderOpen className="size-3.5" />
        </button>
      )}

      {hotIndex !== null && (
        <span
          className={`flex size-4.5 shrink-0 items-center justify-center rounded text-[9.5px] font-semibold tabular-nums ${
            selected
              ? 'bg-brand-500/20 text-brand-600 dark:text-brand-400'
              : 'bg-black/5 text-black/30 dark:bg-white/8 dark:text-white/30'
          }`}
        >
          {hotIndex}
        </span>
      )}
    </div>
  )
})
