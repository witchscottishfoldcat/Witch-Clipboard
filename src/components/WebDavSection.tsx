import { useEffect, useState } from 'react'
import { Cloud, Copy, KeyRound, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import type { WebDavConfig, WebDavSyncStatus } from '@shared/types'
import { api } from '@/lib/api'

interface Props {
  onToast(text: string, tone?: 'ok' | 'warn'): void
}

const EMPTY: WebDavConfig = {
  enabled: false,
  url: '',
  username: '',
  hasPassword: false,
  hasSyncKey: false,
  keyFingerprint: null,
}

export function WebDavSection({ onToast }: Props) {
  const [config, setConfig] = useState<WebDavConfig>(EMPTY)
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [syncKey, setSyncKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<WebDavSyncStatus | null>(null)

  useEffect(() => {
    void Promise.all([api.webDavConfig(), api.webDavStatus()]).then(([next, nextStatus]) => {
      setConfig(next)
      setUrl(next.url)
      setUsername(next.username)
      setStatus(nextStatus)
    })
  }, [])

  const save = async (enabled = config.enabled, manageBusy = true): Promise<boolean> => {
    if (manageBusy) setBusy(true)
    try {
      const next = await api.saveWebDavConfig({
        enabled,
        url,
        username,
        password: password || undefined,
        syncKey: syncKey || undefined,
      })
      setConfig(next)
      setPassword('')
      setSyncKey('')
      onToast('WebDAV 配置已加密保存')
      return true
    } catch (error) {
      setConfig(config)
      onToast(String(error), 'warn')
      return false
    } finally {
      if (manageBusy) setBusy(false)
    }
  }

  const sync = async (): Promise<void> => {
    setBusy(true)
    setStatus((current) => ({
      state: 'syncing',
      lastSyncAt: current?.lastSyncAt ?? null,
      uploaded: 0,
      downloaded: 0,
      deleted: 0,
      error: null,
    }))
    try {
      if (!(await save(true, false))) return
      const next = await api.syncWebDavNow()
      setStatus(next)
      onToast(`同步完成：下载 ${next.downloaded}，删除 ${next.deleted}`)
    } catch (error) {
      setStatus((current) => ({
        state: 'error',
        lastSyncAt: current?.lastSyncAt ?? null,
        uploaded: 0,
        downloaded: 0,
        deleted: 0,
        error: String(error),
      }))
      onToast(String(error), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const copyKey = async (): Promise<void> => {
    try {
      await api.copyWebDavSyncKey()
      onToast('同步密钥已复制；请只交给你自己的设备')
    } catch (error) {
      onToast(String(error), 'warn')
    }
  }

  const inputClass = 'h-8 w-full rounded-lg border border-black/8 bg-white/70 px-2.5 text-[11px] text-black/70 outline-none transition focus:border-brand-500/60 dark:border-white/10 dark:bg-white/6 dark:text-white/70'

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] text-black/45 dark:text-white/45">
        <Cloud className="size-3.5" />
        端到端加密 WebDAV
        <label className="ml-auto flex cursor-pointer items-center gap-1.5">
          <span className="text-[10px]">启用</span>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(event) => {
              const enabled = event.target.checked
              setConfig((current) => ({ ...current, enabled }))
              void save(enabled)
            }}
            className="size-3.5 accent-[var(--color-brand-500)]"
          />
        </label>
      </div>
      <div className="space-y-1.5 rounded-xl bg-black/[0.035] p-2.5 dark:bg-white/[0.055]">
        <input className={inputClass} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://dav.example.com/remote.php/dav/files/name" />
        <div className="grid grid-cols-2 gap-1.5">
          <input className={inputClass} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="用户名" />
          <input className={inputClass} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={config.hasPassword ? '密码已保存（留空不改）' : 'WebDAV 密码'} />
        </div>
        <input className={inputClass} type="password" value={syncKey} onChange={(event) => setSyncKey(event.target.value)} placeholder={config.hasSyncKey ? `同步密钥已保存 · ${config.keyFingerprint}` : '留空自动生成 256 位同步密钥'} />
        <div className="flex gap-1.5">
          <button disabled={busy} onClick={() => void save()} className="h-8 flex-1 rounded-lg bg-black/6 text-[10.5px] text-black/60 transition hover:bg-black/10 disabled:opacity-45 dark:bg-white/8 dark:text-white/60 dark:hover:bg-white/12">保存配置</button>
          <button disabled={busy || !config.hasSyncKey} onClick={() => void copyKey()} title="复制到另一台自己的设备" className="flex size-8 items-center justify-center rounded-lg bg-black/6 text-black/50 transition hover:bg-black/10 disabled:opacity-35 dark:bg-white/8 dark:text-white/55"><Copy className="size-3.5" /></button>
          <button disabled={busy} onClick={() => void sync()} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-500 text-[10.5px] text-white transition hover:bg-brand-600 disabled:opacity-45">
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            立即同步
          </button>
        </div>
      </div>
      <div className="flex items-start gap-1.5 text-[9.5px] leading-4 text-black/35 dark:text-white/35">
        {config.hasSyncKey ? <ShieldCheck className="mt-0.5 size-3 shrink-0 text-emerald-500" /> : <KeyRound className="mt-0.5 size-3 shrink-0" />}
        <span>历史和图片在本机使用 AES-256-GCM 加密后再上传；服务器只看到密文。另一台设备必须使用完全相同的同步密钥。</span>
      </div>
      {status?.error && <div className="text-[9.5px] leading-4 text-red-500">{status.error}</div>}
    </section>
  )
}
