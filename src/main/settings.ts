import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { setLanguage } from '../shared/i18n'
import { SETTINGS_DEFAULTS } from '../shared/recording-reader'
import type { Settings } from '../shared/types'

const FILE = () => join(app.getPath('userData'), 'settings.json')

export const DEFAULTS: Settings = { ...SETTINGS_DEFAULTS, outputDir: join(app.getPath('videos'), 'Traccia') }

let cache: Settings | null = null

export function getSettings(): Settings {
  if (cache) return cache
  let stored: Partial<Settings> = {}
  try {
    if (existsSync(FILE())) stored = JSON.parse(readFileSync(FILE(), 'utf8'))
  } catch (e) {
    console.error('settings: cannot read, using defaults', e)
  }
  // Earlier versions stored a single "shortcut" (Cmd+Shift+R); the two new ones replace it
  delete (stored as Record<string, unknown>).shortcut
  cache = { ...DEFAULTS, ...stored }
  setLanguage(cache.uiLanguage)
  return cache
}

export function updateSettings(patch: Partial<Settings>): Settings {
  cache = { ...getSettings(), ...patch }
  setLanguage(cache.uiLanguage)
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(FILE(), JSON.stringify(cache, null, 2))
  return cache
}
