import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClipItem, ListQuery, Stats } from '@shared/types'
import { api } from '@/lib/api'

interface ItemsState {
  items: ClipItem[]
  total: number
  loading: boolean
}

/** 拉取列表：query 变化时防抖重查，库变更时自动刷新 */
export function useItems(query: ListQuery): ItemsState & { refetch: () => void } {
  const [state, setState] = useState<ItemsState>({ items: [], total: 0, loading: true })
  const key = JSON.stringify(query)
  const seq = useRef(0)

  const fetch = useCallback(async () => {
    const my = ++seq.current
    const res = await api.list(JSON.parse(key) as ListQuery)
    // 丢弃过期响应，避免快速输入时结果乱序
    if (my === seq.current) setState({ items: res.items, total: res.total, loading: false })
  }, [key])

  useEffect(() => {
    const t = setTimeout(() => void fetch(), 90)
    return () => clearTimeout(t)
  }, [fetch])

  useEffect(() => api.onChanged(() => void fetch()), [fetch])

  return { ...state, refetch: () => void fetch() }
}

export function useStats(): Stats | null {
  const [stats, setStats] = useState<Stats | null>(null)

  const load = useCallback(async () => setStats(await api.stats()), [])

  useEffect(() => {
    void load()
    return api.onChanged(() => void load())
  }, [load])

  return stats
}

export function useTags(): string[] {
  const [tags, setTags] = useState<string[]>([])

  const load = useCallback(async () => setTags(await api.tags()), [])

  useEffect(() => {
    void load()
    return api.onChanged(() => void load())
  }, [load])

  return tags
}
