import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import type { ItemKind, ListQuery } from '@shared/types'
import { api } from '@/lib/api'
import { useItems, useStats, useTags } from '@/hooks/useItems'
import { useTheme } from '@/hooks/useTheme'
import { Header } from '@/components/Header'
import { FilterBar } from '@/components/FilterBar'
import { ItemList } from '@/components/ItemList'
import { PreviewPane } from '@/components/PreviewPane'
import { Footer } from '@/components/Footer'
import { SettingsSheet } from '@/components/SettingsSheet'

export default function App() {
  useTheme()

  const [q, setQ] = useState('')
  const [kind, setKind] = useState<ItemKind | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)

  const query = useMemo<ListQuery>(() => ({ q, kind, tag, pinnedOnly }), [q, kind, tag, pinnedOnly])
  const { items, total, loading } = useItems(query)
  const stats = useStats()
  const tags = useTags()

  const selected = items.find((it) => it.id === selectedId) ?? null
  const index = items.findIndex((it) => it.id === selectedId)

  // 结果变化后保证有选中项
  useEffect(() => {
    if (items.length === 0) {
      setSelectedId(null)
    } else if (!items.some((it) => it.id === selectedId)) {
      setSelectedId(items[0].id)
    }
  }, [items, selectedId])

  // 面板每次弹出：清空筛选、回到顶部、聚焦搜索框
  useEffect(
    () =>
      api.onPanelShown(() => {
        setQ('')
        setKind(null)
        setTag(null)
        setPinnedOnly(false)
        setSettingsOpen(false)
        inputRef.current?.focus()
        inputRef.current?.select()
      }),
    [],
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const paste = useCallback((id: number) => void api.paste(id), [])
  const copy = useCallback((id: number) => void api.copy(id), [])
  const togglePin = useCallback((id: number) => void api.togglePin(id), [])
  const remove = useCallback((id: number) => void api.remove(id), [])
  const setItemTags = useCallback((id: number, t: string[]) => void api.setTags(id, t), [])

  const move = useCallback(
    (delta: number) => {
      if (items.length === 0) return
      const from = index < 0 ? 0 : index
      const next = Math.min(Math.max(from + delta, 0), items.length - 1)
      setSelectedId(items[next].id)
    },
    [index, items],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Esc：先清搜索，再收面板
      if (e.key === 'Escape') {
        if (settingsOpen) setSettingsOpen(false)
        else if (q) setQ('')
        else void api.hidePanel()
        return
      }
      if (settingsOpen) return

      // Alt + 1..9 快贴
      if (e.altKey && /^[1-9]$/.test(e.key)) {
        const target = items[Number(e.key) - 1]
        if (target) {
          e.preventDefault()
          paste(target.id)
        }
        return
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          move(1)
          return
        case 'ArrowUp':
          e.preventDefault()
          move(-1)
          return
        case 'PageDown':
          e.preventDefault()
          move(6)
          return
        case 'PageUp':
          e.preventDefault()
          move(-6)
          return
        case 'Home':
          if (!q) {
            e.preventDefault()
            move(-items.length)
          }
          return
        case 'End':
          if (!q) {
            e.preventDefault()
            move(items.length)
          }
          return
        case 'Enter':
          if (selectedId !== null) {
            e.preventDefault()
            paste(selectedId)
          }
          return
        case 'Delete':
          if (selectedId !== null) {
            e.preventDefault()
            remove(selectedId)
          }
          return
      }

      if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
        // 预览区有选中文本时让浏览器默认复制行为生效
        if ((window.getSelection()?.toString() ?? '').length > 0) return
        if (selectedId !== null) {
          e.preventDefault()
          copy(selectedId)
        }
        return
      }
      if (e.ctrlKey && (e.key === 'p' || e.key === 'P')) {
        if (selectedId !== null) {
          e.preventDefault()
          togglePin(selectedId)
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [copy, items, move, paste, q, remove, selectedId, settingsOpen, togglePin])

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-white/74 text-black dark:bg-[#0b0b12]/72 dark:text-white">
      <Header
        value={q}
        onChange={setQ}
        inputRef={inputRef}
        stats={stats}
        onClose={() => void api.hidePanel()}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <FilterBar
        kind={kind}
        onKind={setKind}
        tags={tags}
        activeTag={tag}
        onTag={setTag}
        pinnedOnly={pinnedOnly}
        onPinnedOnly={setPinnedOnly}
      />

      <div className="flex min-h-0 flex-1 border-t border-black/6 dark:border-white/8">
        <ItemList
          items={items}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onPaste={paste}
          onTogglePin={togglePin}
          loading={loading}
        />
        <PreviewPane
          item={selected}
          onPaste={paste}
          onCopy={copy}
          onTogglePin={togglePin}
          onRemove={remove}
          onSetTags={setItemTags}
        />
      </div>

      <Footer count={items.length} total={stats?.total ?? total} />

      <AnimatePresence>
        {settingsOpen && (
          <SettingsSheet
            onClose={() => setSettingsOpen(false)}
            onCleared={() => setSettingsOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
