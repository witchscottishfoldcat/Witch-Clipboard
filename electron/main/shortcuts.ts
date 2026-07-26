import { globalShortcut } from 'electron'
import { togglePanel } from './window'
import { getSettings } from './settings'

let current: string | null = null

/** 注册面板热键；返回是否成功（被别的软件占用时会失败） */
export function registerHotkey(accelerator = getSettings().hotkey): boolean {
  unregisterHotkey()
  try {
    const ok = globalShortcut.register(accelerator, togglePanel)
    if (ok) current = accelerator
    else console.error(`[hotkey] 注册失败，可能已被占用: ${accelerator}`)
    return ok
  } catch (err) {
    console.error('[hotkey] 注册异常', err)
    return false
  }
}

export function unregisterHotkey(): void {
  if (current) {
    globalShortcut.unregister(current)
    current = null
  }
}

export function currentHotkey(): string | null {
  return current
}
