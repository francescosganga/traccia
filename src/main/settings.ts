import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { setLanguage } from '../shared/i18n'
import type { Settings } from '../shared/types'

const FILE = () => join(app.getPath('userData'), 'settings.json')

export const DEFAULTS: Settings = {
  uiLanguage: 'en',
  outputDir: join(app.getPath('videos'), 'Traccia'),
  format: 'mp4',
  resolution: 'native',
  jpgFps: 2,
  skipUnchangedFrames: true,
  audio: true,
  transcribe: true,
  whisperModel: 'base',
  speechLanguage: 'auto',
  trackClicks: true,
  cursorHz: 10,
  countdown: 3,
  showControls: true,
  shortcut: 'CommandOrControl+Shift+R',
  lastMode: 'screen',
  lastDisplayId: null,
  openAtLogin: false,
  startHiddenAtLogin: true,
  showInDock: true
}

let cache: Settings | null = null

export function getSettings(): Settings {
  if (cache) return cache
  let stored: Partial<Settings> = {}
  try {
    if (existsSync(FILE())) stored = JSON.parse(readFileSync(FILE(), 'utf8'))
  } catch (e) {
    console.error('settings: cannot read, using defaults', e)
  }
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
