import { app } from 'electron'
import type { Settings } from '../shared/types'
import { updateSettings } from './settings'
import { broadcast } from './windows'

type Listener = (settings: Settings, patch: Partial<Settings>) => void
const listeners: Listener[] = []

/** Registers a callback that runs after every settings change (shortcut, tray, …). */
export function onSettingsApplied(listener: Listener): void {
  listeners.push(listener)
}

/** Persists a settings patch and applies its OS-level side effects. */
export function applySettings(patch: Partial<Settings>): Settings {
  const settings = updateSettings(patch)
  if ('openAtLogin' in patch && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: !!patch.openAtLogin })
  }
  if ('showInDock' in patch) applyDockVisibility(!!patch.showInDock)
  broadcast('settings:changed', settings)
  for (const l of listeners) l(settings, patch)
  return settings
}

export function applyDockVisibility(visible: boolean): void {
  if (process.platform !== 'darwin' || !app.dock) return
  if (visible) void app.dock.show()
  else app.dock.hide()
}
