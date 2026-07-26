import { useEffect, useState } from 'react'
import { Download, RefreshCw, RotateCcw, Check, TriangleAlert, Info } from 'lucide-react'
import type { UpdateStatus } from '@shared/types'
import { api } from '@/lib/api'

/** 设置页里的「关于与更新」：当前版本 + 检查更新按钮 + 更新流程 */
export function UpdateSection({ onToast }: { onToast: (text: string, tone?: 'ok' | 'warn') => void }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    void api.updateStatus().then(setStatus)
    return api.onUpdateStatus(setStatus)
  }, [])

  const state = status?.state ?? 'idle'
  const busy = state === 'checking' || state === 'downloading'

  const check = async (): Promise<void> => {
    const next = await api.checkUpdate()
    setStatus(next)
    if (next.state === 'none') onToast('已经是最新版本')
    else if (next.state === 'unsupported') onToast('开发模式下不检查更新', 'warn')
    else if (next.state === 'error') onToast(`检查更新失败：${next.error ?? '未知原因'}`, 'warn')
  }

  const rowClass =
    'flex h-8 items-center gap-2 rounded-lg bg-black/5 px-2.5 text-[12px] text-black/70 dark:bg-white/8 dark:text-white/70'

  return (
    <section className="space-y-1.5">
      <div className="text-[11px] text-black/45 dark:text-white/45">关于与更新</div>

      <button
        onClick={() => void check()}
        disabled={busy}
        className={`${rowClass} w-full transition hover:bg-black/8 disabled:opacity-60 dark:hover:bg-white/12`}
      >
        <RefreshCw className={`size-3.5 opacity-60 ${state === 'checking' ? 'animate-spin' : ''}`} />
        {state === 'checking' ? '正在检查更新…' : '检查更新'}
        <span className="ml-auto text-[10.5px] text-black/35 tabular-nums dark:text-white/35">
          当前 v{status?.currentVersion ?? '—'}
        </span>
      </button>

      {/* 有新版本：下载 / 暂不更新 —— 绝不自动下载，也绝不逼着更新 */}
      {(state === 'available' || state === 'downloading' || state === 'ready') && (
        <div className="space-y-2 rounded-lg border border-brand-500/25 bg-brand-500/8 p-2.5">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-black/80 dark:text-white/85">
            <Download className="size-3.5 text-brand-500" />
            新版本 v{status?.version}
          </div>

          {status?.notes && (
            <div className="max-h-24 overflow-y-auto whitespace-pre-wrap text-[10.5px] leading-4 text-black/50 dark:text-white/50">
              {status.notes}
            </div>
          )}

          {state === 'downloading' && (
            <div className="space-y-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-black/8 dark:bg-white/12">
                <div
                  className="h-full rounded-full bg-brand-500 transition-[width] duration-200"
                  style={{ width: `${status?.percent ?? 0}%` }}
                />
              </div>
              <div className="text-[10.5px] text-black/45 tabular-nums dark:text-white/45">
                正在下载 {status?.percent ?? 0}%
              </div>
            </div>
          )}

          <div className="flex gap-1.5">
            {state === 'available' && (
              <button
                onClick={() => void api.downloadUpdate()}
                className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-500 text-[11.5px] font-medium text-white transition hover:bg-brand-600"
              >
                <Download className="size-3.5" />
                下载更新
              </button>
            )}
            {state === 'ready' && (
              <button
                onClick={() => void api.installUpdate()}
                className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-500 text-[11.5px] font-medium text-white transition hover:bg-brand-600"
              >
                <RotateCcw className="size-3.5" />
                重启并安装
              </button>
            )}
            {state !== 'downloading' && (
              <button
                onClick={() => {
                  void api.skipUpdate(status?.version).then((next) => {
                    setStatus(next)
                    onToast('已跳过这个版本，下次启动不再提示')
                  })
                }}
                className="h-7 shrink-0 rounded-lg bg-black/5 px-2.5 text-[11.5px] text-black/60 transition hover:bg-black/10 dark:bg-white/8 dark:text-white/60 dark:hover:bg-white/14"
              >
                暂不更新
              </button>
            )}
          </div>

          {state === 'ready' && (
            <div className="text-[10.5px] leading-4 text-black/45 dark:text-white/45">
              已下载完成。点「重启并安装」会关掉应用装好再自动打开；不点就什么都不会发生。
            </div>
          )}
        </div>
      )}

      {state === 'none' && (
        <div className="flex items-center gap-1.5 text-[10.5px] text-black/45 dark:text-white/45">
          <Check className="size-3 text-emerald-500" />
          已经是最新版本
        </div>
      )}

      {state === 'error' && (
        <div className="flex items-start gap-1.5 text-[10.5px] leading-4 text-black/45 dark:text-white/45">
          <TriangleAlert className="mt-px size-3 shrink-0 text-amber-500" />
          <span>检查更新失败：{status?.error}</span>
        </div>
      )}

      {state === 'unsupported' && (
        <div className="flex items-start gap-1.5 text-[10.5px] leading-4 text-black/45 dark:text-white/45">
          <Info className="mt-px size-3 shrink-0 text-brand-500" />
          <span>开发模式下不检查更新，装好的版本才会。</span>
        </div>
      )}
    </section>
  )
}
