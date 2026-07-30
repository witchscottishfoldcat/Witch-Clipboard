import { useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import QRCode from 'qrcode'
import {
  CheckCircle2,
  Copy,
  LoaderCircle,
  MousePointer2,
  ShieldCheck,
  Smartphone,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import type { ClipItem, CrossDeviceStatus } from '@shared/types'
import { api } from '@/lib/api'

interface Props {
  item: ClipItem | null
  onClose(): void
  onToast(text: string, tone?: 'ok' | 'warn'): void
}

const EMPTY_STATUS: CrossDeviceStatus = {
  running: false,
  url: null,
  pairCode: null,
  connected: false,
  lastSeenAt: null,
  lastSentAt: null,
  lastSentPreview: null,
}

export function CrossDeviceSheet({ item, onClose, onToast }: Props) {
  const [status, setStatus] = useState<CrossDeviceStatus>(EMPTY_STATUS)
  const [qr, setQr] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.crossDeviceStatus())
    } catch {
      // 轮询失败时保留最后一次状态，避免界面闪烁
    }
  }, [])

  useEffect(() => {
    let alive = true
    void api
      .startCrossDevice()
      .then((next) => {
        if (!alive) return
        setStatus(next)
        setError(next.url ? null : '没有检测到可用的局域网地址')
      })
      .catch((reason) => {
        if (!alive) return
        setError(`启动失败：${String(reason)}`)
      })
      .finally(() => {
        if (alive) setBusy(false)
      })

    const timer = window.setInterval(() => void refresh(), 1_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [refresh])

  useEffect(() => {
    let alive = true
    if (!status.url) {
      setQr(null)
      return
    }
    void QRCode.toDataURL(status.url, {
      width: 224,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#241735', light: '#ffffff' },
    }).then((url) => {
      if (alive) setQr(url)
    })
    return () => {
      alive = false
    }
  }, [status.url])

  const stop = async (): Promise<void> => {
    setBusy(true)
    try {
      setStatus(await api.stopCrossDevice())
      setQr(null)
      onToast('跨设备连接已关闭')
    } finally {
      setBusy(false)
    }
  }

  const restart = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const next = await api.startCrossDevice()
      setStatus(next)
      if (!next.url) setError('没有检测到可用的局域网地址')
    } catch (reason) {
      setError(`启动失败：${String(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  const canSend =
    item?.kind === 'image' || (item?.kind === 'text' && item.autoKind !== 'key')

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14 }}
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/28 backdrop-blur-[3px]"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.97, y: 5 }}
        transition={{ duration: 0.17, ease: 'easeOut' }}
        onClick={(event) => event.stopPropagation()}
        className="w-[420px] overflow-hidden rounded-3xl border border-black/8 bg-white/96 shadow-2xl dark:border-white/12 dark:bg-[#16161f]/96"
      >
        <div className="flex items-center gap-2.5 border-b border-black/6 px-5 py-4 dark:border-white/8">
          <div className="flex size-9 items-center justify-center rounded-xl bg-brand-500 text-white shadow-lg shadow-brand-500/25">
            <Smartphone className="size-5" />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-black/85 dark:text-white/90">
              跨设备剪贴板
            </div>
            <div className="mt-0.5 flex items-center text-[10.5px] text-black/40 dark:text-white/40">
              {status.connected ? (
                <>
                  <span className="mr-1.5 size-1.5 rounded-full bg-emerald-500" />
                  手机已连接
                </>
              ) : status.running ? (
                <>
                  <span className="mr-1.5 size-1.5 animate-pulse rounded-full bg-amber-400" />
                  等待手机扫码
                </>
              ) : (
                <>
                  <span className="mr-1.5 size-1.5 rounded-full bg-black/25 dark:bg-white/25" />
                  服务已关闭
                </>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-auto flex size-7 items-center justify-center rounded-lg text-black/40 transition hover:bg-black/8 dark:text-white/40 dark:hover:bg-white/10"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid grid-cols-[168px_1fr] gap-5 p-5">
          <div className="flex min-h-42 items-center justify-center rounded-2xl bg-[#f5f1fb] p-2 dark:bg-white/7">
            {busy && !qr ? (
              <LoaderCircle className="size-7 animate-spin text-brand-500" />
            ) : qr ? (
              <img src={qr} alt="手机配对二维码" className="size-[152px] rounded-xl" />
            ) : (
              <WifiOff className="size-8 text-black/25 dark:text-white/25" />
            )}
          </div>

          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-black/75 dark:text-white/75">
              <Wifi className="size-3.5 text-brand-500" />
              同一 Wi‑Fi 扫码
            </div>
            <p className="mt-2 text-[11px] leading-[1.55] text-black/45 dark:text-white/45">
              手机无需安装 App。连接后先同步电脑当前剪贴板；回到列表点选哪条，就发送哪条。
            </p>
            {status.pairCode && (
              <div className="mt-2 rounded-lg bg-black/4 px-2.5 py-2 text-[10.5px] text-black/45 dark:bg-white/6 dark:text-white/45">
                本次配对码
                <span className="ml-2 font-mono font-semibold tracking-widest text-brand-600 dark:text-brand-400">
                  {status.pairCode}
                </span>
              </div>
            )}
            {error && <div className="mt-2 text-[10.5px] leading-4 text-red-500">{error}</div>}
            <div className="mt-auto flex gap-1.5 pt-3">
              {status.running ? (
                <button
                  onClick={() => void stop()}
                  disabled={busy}
                  className="h-8 flex-1 rounded-lg bg-black/5 text-[11px] text-black/55 transition hover:bg-red-500/12 hover:text-red-600 disabled:opacity-50 dark:bg-white/8 dark:text-white/55"
                >
                  关闭连接
                </button>
              ) : (
                <button
                  onClick={() => void restart()}
                  disabled={busy}
                  className="h-8 flex-1 rounded-lg bg-brand-500 text-[11px] text-white transition hover:bg-brand-600 disabled:opacity-50"
                >
                  重新开启
                </button>
              )}
              {status.url && (
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(status.url ?? '')
                    onToast('配对地址已复制')
                  }}
                  title="复制配对地址"
                  className="flex size-8 items-center justify-center rounded-lg bg-black/5 text-black/50 transition hover:bg-black/10 dark:bg-white/8 dark:text-white/55"
                >
                  <Copy className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="mx-5 mb-4 rounded-2xl border border-black/6 bg-black/[0.025] p-3 dark:border-white/8 dark:bg-white/[0.035]">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />
            <div className="min-w-0">
              <div className="text-[11.5px] font-medium text-black/65 dark:text-white/70">
                安全保护已开启
              </div>
              <div className="mt-0.5 text-[10.5px] leading-4 text-black/40 dark:text-white/40">
                支持文字、链接和图片；Key、Token、密码及文件不会发送。关闭连接后二维码立即失效。
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-black/6 px-5 py-3.5 dark:border-white/8">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] text-black/55 dark:text-white/55">
              {item
                ? canSend
                  ? item.preview
                  : item.autoKind === 'key'
                    ? '当前选中的是 Key，已禁止发送'
                    : '当前选中内容暂不支持发送'
                : '请先在列表中选择一条内容'}
            </div>
            {status.lastSentPreview && (
              <div className="mt-0.5 flex items-center gap-1 truncate text-[9.5px] text-emerald-600/75 dark:text-emerald-400/75">
                <CheckCircle2 className="size-2.5 shrink-0" />
                最近发送：{status.lastSentPreview}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={!status.connected}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-brand-500 px-3.5 text-[11.5px] font-medium text-white shadow-sm shadow-brand-500/25 transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <MousePointer2 className="size-3.5" />
            {status.connected ? '开始选择发送' : '等待手机连接'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
