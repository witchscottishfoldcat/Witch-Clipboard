/**
 * 粘贴回写：
 * 弹面板前记下当时的前台窗口 → 选中条目后写剪贴板 → 隐藏面板 →
 * SetForegroundWindow 把焦点还给原窗口 → 释放残留修饰键 → 模拟 Ctrl+V。
 */
import * as win32 from './win32'

let previous: unknown = null
let previousExe: string | null = null

/** 面板显示前调用 */
export function rememberForegroundWindow(): void {
  const info = win32.foregroundWindow()
  previous = info?.hwnd ?? null
  previousExe = info?.exe ?? null
}

export function previousApp(): string | null {
  return previousExe
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export interface PasteResult {
  ok: boolean
  /** 失败原因，用于告诉用户「已复制，请手动粘贴」 */
  reason?: 'no-native' | 'no-target' | 'focus-failed' | 'send-failed'
}

export async function pasteToPreviousWindow(): Promise<PasteResult> {
  if (!win32.hasNative()) return { ok: false, reason: 'no-native' }
  if (!previous) return { ok: false, reason: 'no-target' }

  // 面板刚隐藏，等系统把焦点交回去
  await sleep(50)

  const focused = win32.focusWindow(previous)
  if (!focused) {
    // 有些窗口拒绝被抢焦点；再等一拍重试一次
    await sleep(80)
    if (!win32.focusWindow(previous)) return { ok: false, reason: 'focus-failed' }
  }

  await sleep(60)
  return win32.sendCtrlV() ? { ok: true } : { ok: false, reason: 'send-failed' }
}
