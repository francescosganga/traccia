import { app, globalShortcut } from 'electron'
import type { AppState, RecordingRequest, Settings } from '../shared/types'
import { applyDockVisibility, onSettingsApplied } from './apply-settings'
import { setupAutotest } from './autotest'
import { registerIpc } from './ipc'
import { setupScreenshots, useScreenshotProfile } from './screenshots'
import { RecordingSession } from './session'
import { getSettings, updateSettings } from './settings'
import { createTray, refreshTray, updateTray, type TrayActions } from './tray'
import { cleanupLegacyModels, killWorker } from './whisper'
import {
  broadcast,
  createMainWindow,
  getMainWindow,
  hideControls,
  hideMainWindow,
  selectRegion,
  setQuitting,
  showControls,
  showMainWindow
} from './windows'

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.setName('Traccia')
useScreenshotProfile()

const session = new RecordingSession({
  engine: () => getMainWindow()?.webContents ?? null,
  showControls,
  hideControls,
  hideMainWindow,
  showMainWindow,
  onState: (state: AppState) => {
    broadcast('state', state)
    void updateTray(state)
    autotestState(state)
  }
})

/** Entry point for every "start recording" request (UI, tray, shortcut). */
async function startRecording(req: RecordingRequest): Promise<void> {
  if (session.isBusy) return
  updateSettings({ lastMode: req.mode, lastDisplayId: req.displayId ?? null })
  if (req.mode === 'region' && !req.region) {
    session.state = { status: 'selecting' }
    broadcast('state', session.state)
    hideMainWindow()
    const selection = await selectRegion()
    if (!selection) {
      session.state = { status: 'idle' }
      broadcast('state', session.state)
      showMainWindow()
      return
    }
    req = { mode: 'region', displayId: selection.displayId, region: selection.rect }
  }
  await session.start(req)
}

const recordScreen = (): void => void startRecording({ mode: 'screen', displayId: getSettings().lastDisplayId ?? undefined })
const recordRegion = (): void => void startRecording({ mode: 'region' })

/** A shortcut stops the recording in progress, otherwise it starts one. */
function stopOrStart(start: () => void): () => void {
  return () => {
    const { status } = session.state
    if (status === 'recording' || status === 'countdown') session.requestStop()
    else if (status === 'idle' || status === 'done' || status === 'error') start()
  }
}

const trayActions: TrayActions = {
  recordScreen,
  recordRegion,
  stop: () => session.requestStop(),
  open: () => showMainWindow(),
  settings: () => {
    showMainWindow()
    broadcast('navigate', 'settings')
  }
}

function registerShortcuts(settings: Settings): void {
  globalShortcut.unregisterAll()
  if (!settings.shortcutsEnabled) return
  const bindings: [string, () => void][] = [
    [settings.shortcutScreen, stopOrStart(recordScreen)],
    [settings.shortcutRegion, stopOrStart(recordRegion)]
  ]
  for (const [accelerator, handler] of bindings) {
    if (!accelerator) continue
    try {
      const ok = globalShortcut.register(accelerator, handler)
      if (!ok) console.warn('shortcut not registered:', accelerator)
    } catch (e) {
      console.warn('invalid shortcut', accelerator, e)
    }
  }
}

const autotestState = setupAutotest((req) => startRecording(req), () => session.requestStop())

app.whenReady().then(() => {
  const settings = getSettings()
  registerIpc({ session, startRecording })
  onSettingsApplied((s, patch) => {
    if ('shortcutsEnabled' in patch || 'shortcutScreen' in patch || 'shortcutRegion' in patch) registerShortcuts(s)
    void refreshTray()
  })

  applyDockVisibility(settings.showInDock)
  // When launched as a login item the app can live in the menu bar only.
  const openedAtLogin = process.platform === 'darwin' && app.isPackaged && app.getLoginItemSettings().wasOpenedAtLogin
  const win = createMainWindow({ show: !(openedAtLogin && settings.startHiddenAtLogin) })
  setupScreenshots(win)
  createTray(trayActions)
  registerShortcuts(settings)
  void cleanupLegacyModels()
})

app.on('second-instance', () => showMainWindow())
app.on('activate', () => showMainWindow())
app.on('window-all-closed', () => {
  // Stay alive in the menu bar; the user quits from the tray or Cmd+Q.
})
app.on('before-quit', () => {
  setQuitting()
  globalShortcut.unregisterAll()
  killWorker()
})
