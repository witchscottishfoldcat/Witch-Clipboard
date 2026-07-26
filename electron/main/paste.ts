/**
 * 粘贴回写。
 * P3 会用 koffi 直接调 Win32 SendInput：记住弹面板前的前台窗口 →
 * 写剪贴板 → 隐藏面板并 SetForegroundWindow 还原 → 发 Ctrl+V。
 * P0 先留占位，剪贴板写入已经生效，用户手动 Ctrl+V 即可。
 */
export async function pasteToPreviousWindow(): Promise<void> {
  // TODO(P3): koffi + SendInput
}

/** 弹面板前调用，记录当前前台窗口句柄 */
export function rememberForegroundWindow(): void {
  // TODO(P3): GetForegroundWindow
}
