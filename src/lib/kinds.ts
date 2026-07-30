import type { AutoKind, ClipItem, FilterId, ItemKind } from '@shared/types'

export interface Badge {
  label: string
  /** 用于徽标/左侧色条的 Tailwind 类 */
  chip: string
  bar: string
}

const BADGES: Record<AutoKind | 'image' | 'files', Badge> = {
  plain: {
    label: '文本',
    chip: 'bg-slate-500/12 text-slate-600 dark:text-slate-300',
    bar: 'bg-slate-400/70',
  },
  url: {
    label: '链接',
    chip: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    bar: 'bg-sky-400',
  },
  key: {
    label: 'Key',
    chip: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300',
    bar: 'bg-fuchsia-400',
  },
  model: {
    label: '模型',
    chip: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
    bar: 'bg-cyan-400',
  },
  code: {
    label: '代码',
    chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    bar: 'bg-emerald-400',
  },
  color: {
    label: '颜色',
    chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    bar: 'bg-amber-400',
  },
  path: {
    label: '路径',
    chip: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
    bar: 'bg-orange-400',
  },
  email: {
    label: '邮箱',
    chip: 'bg-pink-500/15 text-pink-700 dark:text-pink-300',
    bar: 'bg-pink-400',
  },
  number: {
    label: '数字',
    chip: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300',
    bar: 'bg-zinc-400',
  },
  image: {
    label: '图片',
    chip: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    bar: 'bg-violet-400',
  },
  files: {
    label: '文件',
    chip: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
    bar: 'bg-teal-400',
  },
}

export function badgeOf(item: ClipItem): Badge {
  if (item.kind === 'image') return BADGES.image
  if (item.kind === 'files') return BADGES.files
  return BADGES[item.autoKind] ?? BADGES.plain
}

export interface KindFilter {
  id: FilterId
  label: string
  kind: ItemKind | null
  autoKind: AutoKind | null
}

export const KIND_FILTERS: KindFilter[] = [
  { id: 'all', label: '全部', kind: null, autoKind: null },
  { id: 'text', label: '文字', kind: 'text', autoKind: null },
  { id: 'image', label: '图片', kind: 'image', autoKind: null },
  { id: 'files', label: '文件', kind: 'files', autoKind: null },
  { id: 'url', label: '链接', kind: 'text', autoKind: 'url' },
  { id: 'key', label: 'Key', kind: 'text', autoKind: 'key' },
  { id: 'model', label: '模型', kind: 'text', autoKind: 'model' },
  { id: 'code', label: '代码', kind: 'text', autoKind: 'code' },
  { id: 'color', label: '颜色', kind: 'text', autoKind: 'color' },
  { id: 'path', label: '路径', kind: null, autoKind: 'path' },
  { id: 'email', label: '邮箱', kind: 'text', autoKind: 'email' },
  { id: 'number', label: '数字', kind: 'text', autoKind: 'number' },
]

export const DEFAULT_VISIBLE_FILTERS: FilterId[] = ['all', 'text', 'image', 'files', 'url', 'key']

export function visibleKindFilters(ids: FilterId[]): KindFilter[] {
  const visible = new Set<FilterId>(['all', ...ids])
  return KIND_FILTERS.filter((filter) => visible.has(filter.id))
}

/** 颜色类条目：抽出可直接用于 style 的颜色值 */
export function colorValue(item: ClipItem): string | null {
  if (item.kind !== 'text' || item.autoKind !== 'color') return null
  return (item.text ?? '').trim()
}
