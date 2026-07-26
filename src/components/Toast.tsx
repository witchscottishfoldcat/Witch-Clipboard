import { AnimatePresence, motion } from 'motion/react'
import { Check, TriangleAlert } from 'lucide-react'

export interface ToastMessage {
  id: number
  text: string
  tone: 'ok' | 'warn'
}

export function Toast({ message }: { message: ToastMessage | null }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          key={message.id}
          initial={{ opacity: 0, y: 10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.98 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="pointer-events-none absolute bottom-11 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-black/8 bg-white/92 px-3 py-1.5 text-[11.5px] whitespace-nowrap text-black/75 shadow-lg backdrop-blur-xl dark:border-white/12 dark:bg-[#1b1b26]/92 dark:text-white/80"
        >
          {message.tone === 'ok' ? (
            <Check className="size-3.5 text-emerald-500" strokeWidth={2.6} />
          ) : (
            <TriangleAlert className="size-3.5 text-amber-500" strokeWidth={2.4} />
          )}
          {message.text}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
