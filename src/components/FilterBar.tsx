import { Pin, Tag as TagIcon } from 'lucide-react'
import type { AutoKind, FilterId, ItemKind } from '@shared/types'
import { visibleKindFilters } from '@/lib/kinds'

interface Props {
  kind: ItemKind | null
  onKind: (k: ItemKind | null) => void
  autoKind: AutoKind | null
  onAutoKind: (k: AutoKind | null) => void
  tags: string[]
  activeTag: string | null
  onTag: (t: string | null) => void
  pinnedOnly: boolean
  onPinnedOnly: (v: boolean) => void
  visibleFilters: FilterId[]
}

const chipBase =
  'inline-flex h-6.5 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-medium transition select-none'
const chipOff =
  'bg-black/5 text-black/55 hover:bg-black/10 hover:text-black/80 dark:bg-white/7 dark:text-white/55 dark:hover:bg-white/12 dark:hover:text-white/85'
const chipOn = 'bg-brand-500 text-white shadow-sm shadow-brand-500/30'

export function FilterBar({
  kind,
  onKind,
  autoKind,
  onAutoKind,
  tags,
  activeTag,
  onTag,
  pinnedOnly,
  onPinnedOnly,
  visibleFilters,
}: Props) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto px-3.5 pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {visibleKindFilters(visibleFilters).map((f) => (
        <button
          key={f.id}
          onClick={() => {
            onKind(f.kind)
            onAutoKind(f.autoKind)
          }}
          className={`${chipBase} ${
            kind === f.kind && autoKind === f.autoKind ? chipOn : chipOff
          }`}
        >
          {f.label}
        </button>
      ))}

      <button
        onClick={() => onPinnedOnly(!pinnedOnly)}
        className={`${chipBase} ${pinnedOnly ? chipOn : chipOff}`}
      >
        <Pin className="size-3" strokeWidth={2.5} />
        置顶
      </button>

      {tags.length > 0 && <span className="mx-0.5 h-4 w-px shrink-0 bg-black/10 dark:bg-white/12" />}

      {tags.map((t) => (
        <button
          key={t}
          onClick={() => onTag(activeTag === t ? null : t)}
          className={`${chipBase} ${activeTag === t ? chipOn : chipOff}`}
        >
          <TagIcon className="size-3" strokeWidth={2.5} />
          {t}
        </button>
      ))}
    </div>
  )
}
