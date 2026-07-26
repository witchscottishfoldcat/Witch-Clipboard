import { useEffect, useState } from 'react'
import type { Settings } from '@shared/types'
import { api } from '@/lib/api'

/** 把 settings.theme 落到 <html data-theme>，system 时跟随系统 */
export function useTheme(): 'light' | 'dark' {
  const [pref, setPref] = useState<Settings['theme']>('system')
  const [resolved, setResolved] = useState<'light' | 'dark'>('dark')

  useEffect(() => {
    void api.getSettings().then((s) => setPref(s.theme))
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const next = pref === 'system' ? (mq.matches ? 'dark' : 'light') : pref
      document.documentElement.dataset['theme'] = next
      setResolved(next)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [pref])

  return resolved
}
