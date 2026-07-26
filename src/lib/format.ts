export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const min = 60_000
  const hour = 3_600_000
  const day = 86_400_000

  if (diff < min) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`

  const d = new Date(ts)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return sameYear ? md : `${d.getFullYear()}年${md}`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function absoluteTime(ts: number): string {
  const d = new Date(ts)
  const p = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
