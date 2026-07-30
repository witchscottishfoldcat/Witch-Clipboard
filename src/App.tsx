import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import type { AutoKind, ItemKind, ListQuery, PasteOutcome, UpdateStatus } from '@shared/types'
import { api } from '@/lib/api'
import { useItems, useStats, useTags } from '@/hooks/useItems'
import { useTheme } from '@/hooks/useTheme'
import { Header } from '@/components/Header'
import { FilterBar } from '@/components/FilterBar'
import { ItemList } from '@/components/ItemList'
import { PreviewPane } from '@/components/PreviewPane'
import { Footer } from '@/components/Footer'
import { SettingsSheet } from '@/components/SettingsSheet'
import { Toast, type ToastMessage } from '@/components/Toast'
import { UpdateBanner } from '@/components/UpdateBanner'
import { CrossDeviceSheet } from '@/components/CrossDeviceSheet'

const PASTE_FAILURE_TEXT: Record<NonNullable<PasteOutcome['reason']>, string> = {
  'no-native': '已复制到剪贴板，请手动 Ctrl+V（原生能力不可用）',
  'no-target': '已复制，但没记录到目标窗口，请手动 Ctrl+V',
  'focus-failed': '已复制，但切不回原窗口，请手动 Ctrl+V',
  'send-failed': '已复制，模拟按键失败，请手动 Ctrl+V',
  'not-found': '这条记录已经不存在了',
}

export default function App() {
  useTheme()

  const [q, setQ] = useState('')
  const [kind, setKind] = useState<ItemKind | null>(null)
  const [autoKind, setAutoKind] = useState<AutoKind | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [crossDeviceOpen, setCrossDeviceOpen] = useState(false)
  const [hotkey, setHotkey] = useState('Alt+V')
  const [quickPasteModifiers, setQuickPasteModifiers] = useState('Ctrl+Alt')
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [update, setUpdate] = useState<UpdateStatus | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastSeq = useRef(0)

  const query = useMemo<ListQuery>(
    () => ({ q, kind, autoKind, tag, pinnedOnly }),
    [q, kind, autoKind, tag, pinnedOnly],
  )
  const { items, total, loading } = useItems(query)
  const stats = useStats()
  const tags = useTags()

  const selected = items.find((it) => it.id === selectedId) ?? null
  const index = items.findIndex((it) => it.id === selectedId)
  const filtered = Boolean(q || kind || autoKind || tag || pinnedOnly)

  const showToast = useCallback((text: string, tone: 'ok' | 'warn' = 'ok') => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ id: ++toastSeq.current, text, tone })
    toastTimer.current = setTimeout(() => setToast(null), tone === 'warn' ? 3600 : 1800)
  }, [])

  const loadHotkeys = useCallback(() => {
    void api.getSettings().then((s) => {
      setHotkey(s.hotkey)
      setQuickPasteModifiers(s.quickPasteModifiers)
    })
  }, [])

  useEffect(() => loadHotkeys(), [loadHotkeys])

  // 更新状态：主进程启动后会自动查一次，有结果就推过来
  useEffect(() => {
    void api.updateStatus().then(setUpdate)
    return api.onUpdateStatus(setUpdate)
  }, [])

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
        setAutoKind(null)
        setTag(null)
        setPinnedOnly(false)
        setSettingsOpen(false)
        setCrossDeviceOpen(false)
        inputRef.current?.focus()
        inputRef.current?.select()
      }),
    [],
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const paste = useCallback(
    (id: number) => {
      void api.paste(id).then((r) => {
        if (!r.ok) showToast(PASTE_FAILURE_TEXT[r.reason ?? 'send-failed'], 'warn')
      })
    },
    [showToast],
  )

  const copy = useCallback(
    (id: number) => {
      void api.copy(id).then(() => showToast('已复制到剪贴板'))
    },
    [showToast],
  )

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
      if (e.key === 'Escape') {
        if (crossDeviceOpen) setCrossDeviceOpen(false)
        else if (settingsOpen) setSettingsOpen(false)
        else if (q) setQ('')
        else void api.hidePanel()
        return
      }
      if (settingsOpen || crossDeviceOpen) return

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
        return
      }
      // 用 e.code：中文输入法激活时 e.key 拿不到逗号
      if (e.ctrlKey && (e.code === 'Comma' || e.key === ',')) {
        e.preventDefault()
        setSettingsOpen(true)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    copy,
    crossDeviceOpen,
    items,
    move,
    paste,
    q,
    remove,
    selectedId,
    settingsOpen,
    togglePin,
  ])

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-white/74 text-black dark:bg-[#0b0b12]/72 dark:text-white">
      <Header
        value={q}
        onChange={setQ}
        inputRef={inputRef}
        stats={stats}
        onClose={() => void api.hidePanel()}
        onOpenSettings={() => {
          setCrossDeviceOpen(false)
          setSettingsOpen(true)
        }}
        onOpenCrossDevice={() => {
          setSettingsOpen(false)
          setCrossDeviceOpen(true)
        }}
      />

      <AnimatePresence>
        {(update?.state === 'available' || update?.state === 'ready') && (
          <UpdateBanner
            status={update}
            onOpen={() => setSettingsOpen(true)}
            onSkip={() => void api.skipUpdate(update.version).then(setUpdate)}
          />
        )}
      </AnimatePresence>

      <FilterBar
        kind={kind}
        onKind={setKind}
        autoKind={autoKind}
        onAutoKind={setAutoKind}
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
          libraryEmpty={!filtered && (stats?.total ?? 0) === 0}
          hotkey={hotkey}
        />
        <PreviewPane
          item={selected}
          onPaste={paste}
          onCopy={copy}
          onTogglePin={togglePin}
          onRemove={remove}
          onSetTags={setItemTags}
          onReveal={(id) => void api.revealFile(id)}
        />
      </div>

      <Footer
        count={items.length}
        total={stats?.total ?? total}
        quickPasteModifiers={quickPasteModifiers}
      />

      <Toast message={toast} />

      <AnimatePresence>
        {settingsOpen && (
          <SettingsSheet
            onClose={() => {
              setSettingsOpen(false)
              loadHotkeys()
            }}
            onCleared={() => setSettingsOpen(false)}
            onToast={showToast}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {crossDeviceOpen && (
          <CrossDeviceSheet
            item={selected}
            onClose={() => setCrossDeviceOpen(false)}
            onToast={showToast}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
