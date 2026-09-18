import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { setLanguage } from '../shared/i18n'
import { SHORTCUT_PRESETS } from '../shared/shortcuts'
import type { Settings } from '../shared/types'

const FILE = () => join(app.getPath('userData'), 'settings.json')

export const DEFAULTS: Settings = {
  onboardingDone: false,
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
  // Off until the user picks the keys: the macOS ones fire the system screenshot until disabled in System Settings
  shortcutsEnabled: false,
  shortcutScreen: SHORTCUT_PRESETS.mac.screen,
  shortcutRegion: SHORTCUT_PRESETS.mac.region,
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
