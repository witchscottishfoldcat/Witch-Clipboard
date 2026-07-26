import { motion } from 'motion/react'
import { Sparkles, X } from 'lucide-react'
import type { UpdateStatus } from '@shared/types'

interface Props {
  status: UpdateStatus
  onOpen: () => void
  onSkip: () => void
}

/** 面板顶部的一条更新提示。只提示，不挡路，也不能逼着用户更新 */
export function UpdateBanner({ status, onOpen, onSkip }: Props) {
  const ready = status.state === 'ready'

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="overflow-hidden"
    >
      <div className="mx-3.5 mb-2 flex items-center gap-2 rounded-lg border border-brand-500/25 bg-brand-500/10 px-2.5 py-1.5">
        <Sparkles className="size-3.5 shrink-0 text-brand-500" />
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-black/75 dark:text-white/80">
          {ready ? `v${status.version} 已下载完成，可以重启安装` : `有新版本 v${status.version}`}
        </span>
        <button
          onClick={onOpen}
          className="h-6 shrink-0 rounded-md bg-brand-500 px-2 text-[11px] font-medium text-white transition hover:bg-brand-600"
        >
          {ready ? '去安装' : '查看'}
        </button>
        <button
          onClick={onSkip}
          title="暂不更新（下次启动不再提示这个版本）"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-black/40 transition hover:bg-black/8 hover:text-black/70 dark:text-white/40 dark:hover:bg-white/10"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </motion.div>
  )
}
