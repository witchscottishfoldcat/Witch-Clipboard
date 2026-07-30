import type { AccentPalette } from '@shared/types'

export interface AccentOption {
  id: AccentPalette
  label: string
  color: string
}

export const ACCENT_OPTIONS: AccentOption[] = [
  { id: 'violet', label: '紫罗兰', color: '#7c5cf4' },
  { id: 'blue', label: '海蓝', color: '#3276dd' },
  { id: 'cyan', label: '湖蓝', color: '#1595ae' },
  { id: 'teal', label: '青绿', color: '#17877d' },
  { id: 'green', label: '森绿', color: '#2f9251' },
  { id: 'amber', label: '琥珀', color: '#c87b19' },
  { id: 'rose', label: '玫红', color: '#cf4860' },
]

export function applyAccent(accent: AccentPalette): void {
  document.documentElement.dataset['accent'] = accent
}
