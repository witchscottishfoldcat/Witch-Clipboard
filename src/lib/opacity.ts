export function normalizePanelBackgroundOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return 90
  return Math.min(100, Math.max(20, Math.round(opacity)))
}

export function applyPanelBackgroundOpacity(opacity: number): void {
  const normalized = normalizePanelBackgroundOpacity(opacity)
  document.documentElement.style.setProperty(
    '--panel-background-opacity',
    String(normalized / 100),
  )
}
