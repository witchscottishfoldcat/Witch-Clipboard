/**
 * Win32 原生调用（koffi，无需编译）。
 * 全部包在 try 里：拿不到原生能力时降级，不让应用崩。
 */
import koffi from 'koffi'
import { basename } from 'node:path'

const VK = {
  SHIFT: 0x10,
  CONTROL: 0x11,
  MENU: 0x12, // Alt
  LWIN: 0x5b,
  RWIN: 0x5c,
  V: 0x56,
} as const

const KEYEVENTF_KEYUP = 0x0002
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

/** 密码管理器用来标记「别记录我」的剪贴板格式 */
const SENSITIVE_FORMATS = [
  'ExcludeClipboardContentFromMonitorProcessing',
  'CanIncludeInClipboardHistory',
  'Clipboard Viewer Ignore',
]

interface Native {
  GetClipboardSequenceNumber: () => number
  GetForegroundWindow: () => unknown
  SetForegroundWindow: (hwnd: unknown) => boolean
  GetWindowThreadProcessId: (hwnd: unknown, pid: number[]) => number
  RegisterClipboardFormatW: (name: string) => number
  IsClipboardFormatAvailable: (format: number) => boolean
  keybd_event: (vk: number, scan: number, flags: number, extra: number) => void
  GetAsyncKeyState: (vk: number) => number
  OpenProcess: (access: number, inherit: boolean, pid: number) => unknown
  QueryFullProcessImageNameW: (
    handle: unknown,
    flags: number,
    buf: Uint16Array,
    size: number[],
  ) => boolean
  CloseHandle: (handle: unknown) => boolean
}

const native: Native | null = load()

function load(): Native | null {
  if (process.platform !== 'win32') return null
  try {
    const user32 = koffi.load('user32.dll')
    const kernel32 = koffi.load('kernel32.dll')
    return {
      GetClipboardSequenceNumber: user32.func('uint32 __stdcall GetClipboardSequenceNumber()'),
      GetForegroundWindow: user32.func('void* __stdcall GetForegroundWindow()'),
      SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(void* hWnd)'),
      GetWindowThreadProcessId: user32.func(
        'uint32 __stdcall GetWindowThreadProcessId(void* hWnd, _Out_ uint32* lpdwProcessId)',
      ),
      RegisterClipboardFormatW: user32.func(
        'uint32 __stdcall RegisterClipboardFormatW(str16 lpszFormat)',
      ),
      IsClipboardFormatAvailable: user32.func(
        'bool __stdcall IsClipboardFormatAvailable(uint32 format)',
      ),
      keybd_event: user32.func(
        'void __stdcall keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)',
      ),
      GetAsyncKeyState: user32.func('int16 __stdcall GetAsyncKeyState(int vKey)'),
      OpenProcess: kernel32.func(
        'void* __stdcall OpenProcess(uint32 dwDesiredAccess, bool bInheritHandle, uint32 dwProcessId)',
      ),
      QueryFullProcessImageNameW: kernel32.func(
        'bool __stdcall QueryFullProcessImageNameW(void* hProcess, uint32 dwFlags, _Out_ uint16* lpExeName, _Inout_ uint32* lpdwSize)',
      ),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(void* handle)'),
    }
  } catch (err) {
    console.error('[win32] 原生能力加载失败，将降级运行：', (err as Error).message)
    return null
  }
}

export const hasNative = (): boolean => native !== null

/**
 * 剪贴板序列号：每次剪贴板内容变化就自增。
 * 一次极便宜的系统调用，省掉了轮询里反复解码剪贴板内容的开销。
 */
export function clipboardSequence(): number | null {
  try {
    return native ? native.GetClipboardSequenceNumber() : null
  } catch {
    return null
  }
}

/** 剪贴板里是否带「不要记录」标记（密码管理器会写） */
export function hasSensitiveMarker(): boolean {
  if (!native) return false
  try {
    for (const name of SENSITIVE_FORMATS) {
      const id = native.RegisterClipboardFormatW(name)
      if (id !== 0 && native.IsClipboardFormatAvailable(id)) return true
    }
  } catch {
    /* 拿不到就当没有标记 */
  }
  return false
}

export interface ForegroundInfo {
  hwnd: unknown
  /** 进程可执行文件名，如 chrome.exe */
  exe: string | null
}

export function foregroundWindow(): ForegroundInfo | null {
  if (!native) return null
  try {
    const hwnd = native.GetForegroundWindow()
    if (!hwnd) return null
    return { hwnd, exe: exeOfWindow(hwnd) }
  } catch {
    return null
  }
}

function exeOfWindow(hwnd: unknown): string | null {
  if (!native) return null
  let handle: unknown = null
  try {
    const pid: number[] = [0]
    native.GetWindowThreadProcessId(hwnd, pid)
    if (!pid[0]) return null

    handle = native.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid[0])
    if (!handle) return null

    const buf = new Uint16Array(520)
    const size: number[] = [buf.length]
    if (!native.QueryFullProcessImageNameW(handle, 0, buf, size)) return null

    const full = Buffer.from(buf.buffer, 0, size[0] * 2).toString('utf16le')
    return full ? basename(full) : null
  } catch {
    return null
  } finally {
    if (handle && native) {
      try {
        native.CloseHandle(handle)
      } catch {
        /* ignore */
      }
    }
  }
}

export function focusWindow(hwnd: unknown): boolean {
  if (!native || !hwnd) return false
  try {
    return native.SetForegroundWindow(hwnd)
  } catch {
    return false
  }
}

/**
 * 模拟 Ctrl+V。
 * 先把可能还按着的修饰键放开——热键 Alt+V 唤出面板时 Alt 往往仍处于按下状态，
 * 直接发 Ctrl+V 会变成 Ctrl+Alt+V，目标程序收不到粘贴。
 */
export function sendCtrlV(): boolean {
  if (!native) return false
  try {
    for (const vk of [VK.MENU, VK.SHIFT, VK.LWIN, VK.RWIN, VK.CONTROL]) {
      if ((native.GetAsyncKeyState(vk) & 0x8000) !== 0) {
        native.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
      }
    }
    native.keybd_event(VK.CONTROL, 0, 0, 0)
    native.keybd_event(VK.V, 0, 0, 0)
    native.keybd_event(VK.V, 0, KEYEVENTF_KEYUP, 0)
    native.keybd_event(VK.CONTROL, 0, KEYEVENTF_KEYUP, 0)
    return true
  } catch (err) {
    console.error('[win32] 模拟粘贴失败', err)
    return false
  }
}
