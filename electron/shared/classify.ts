import type { AutoKind } from './types'

const RE_URL = /^(https?:\/\/|www\.)\S+$/i
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const RE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))$/i
const RE_PATH = /^([a-z]:[\\/]|\\\\|\.{1,2}[\\/]|\/)[^\n]{1,300}$/i
const RE_NUMBER = /^[-+]?\d[\d\s,._]*$/
const RE_KEY_PREFIX =
  /^(?:sk-[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|AKIA[A-Z0-9]{16}|AIza[a-z0-9_-]{20,}|xox[baprs]-[a-z0-9-]{10,})$/i
const RE_JWT = /^eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+$/i
const RE_NAMED_KEY =
  /^(?:api[_ -]?key|access[_ -]?key|secret(?:[_ -]?key)?|token|license[_ -]?key)\s*[:=]\s*["']?[a-z0-9_./+=-]{8,}["']?$/i
const RE_LICENSE_KEY = /^(?=.*[a-z])(?=.*\d)[a-z0-9]{4,}(?:-[a-z0-9]{4,}){2,}$/i

/** 代码特征：出现结构性符号或常见关键字 */
const CODE_HINTS = [
  /[;{}]\s*$/m,
  /^\s*(?:import|export|from|const|let|var|function|class|def|fn|package|using|public|private)\b/m,
  /=>|::|->|<\/[a-z]/,
  /^\s*(?:\$|>|#)\s+\S+/m,
]

export function classify(text: string): AutoKind {
  const t = text.trim()
  if (!t) return 'plain'
  const oneLine = !t.includes('\n')

  if (oneLine) {
    if (RE_URL.test(t)) return 'url'
    if (
      RE_KEY_PREFIX.test(t) ||
      RE_JWT.test(t) ||
      RE_NAMED_KEY.test(t) ||
      RE_LICENSE_KEY.test(t)
    ) {
      return 'key'
    }
    if (RE_EMAIL.test(t)) return 'email'
    if (RE_COLOR.test(t)) return 'color'
    if (RE_PATH.test(t)) return 'path'
    if (RE_NUMBER.test(t) && t.length <= 32) return 'number'
  }

  let hits = 0
  for (const re of CODE_HINTS) if (re.test(t)) hits++
  // 单行只要命中一条结构特征还不够，多行代码通常会命中两条以上
  if (hits >= 2 || (hits >= 1 && !oneLine && t.split('\n').length >= 3)) return 'code'

  return 'plain'
}

/** 生成列表用摘要：取首个非空行，折叠连续空白 */
export function makePreview(text: string, max = 160): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? ''
  const flat = line.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max) + '…' : flat
}
