import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { Settings } from '@shared/types'

const DEFAULTS: Settings = {
  hotkey: 'Alt+V',
  maxItems: 2000,
  maxDays: 30,
  skipSensitive: true,
  hideAfterPaste: true,
  theme: 'system',
}

let cache: Settings | null = null

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): Settings {
  if (cache) return cache
  try {
    // 手工编辑过的文件可能带 UTF-8 BOM，JSON.parse 会直接抛
    const text = readFileSync(file(), 'utf8').replace(/^﻿/, '')
    const raw = JSON.parse(text) as Partial<Settings>
    cache = { ...DEFAULTS, ...raw }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  cache = next
  try {
    mkdirSync(dirname(file()), { recursive: true })
    writeFileSync(file(), JSON.stringify(next, null, 2), 'utf8')
  } catch (err) {
    console.error('[settings] 写入失败', err)
  }
  return next
}
