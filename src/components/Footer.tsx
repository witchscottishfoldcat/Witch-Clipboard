interface Props {
  count: number
  total: number
}

const KEYS: [string, string][] = [
  ['↑↓', '选择'],
  ['Enter', '粘贴'],
  ['Alt+1…9', '快贴'],
  ['Ctrl+C', '复制'],
  ['Ctrl+P', '置顶'],
  ['Del', '删除'],
  ['Ctrl+,', '设置'],
  ['Esc', '收起'],
]

export function Footer({ count, total }: Props) {
  return (
    <div className="flex items-center gap-2.5 border-t border-black/6 px-3.5 py-2 text-[10.5px] text-black/40 dark:border-white/8 dark:text-white/40">
      {KEYS.map(([k, label]) => (
        <span key={k} className="flex items-center gap-1">
          <kbd className="rounded border border-black/10 bg-black/4 px-1 py-px font-sans text-[10px] text-black/55 dark:border-white/12 dark:bg-white/8 dark:text-white/60">
            {k}
          </kbd>
          {label}
        </span>
      ))}
      <span className="ml-auto tabular-nums">
        {count === total ? `${total}` : `${count} / ${total}`}
      </span>
    </div>
  )
}
