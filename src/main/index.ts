import { app, globalShortcut } from 'electron'
import type { AppState, RecordingRequest, Settings } from '../shared/types'
import { applyDockVisibility, onSettingsApplied } from './apply-settings'
import { setupAutotest } from './autotest'
import { registerIpc } from './ipc'
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

function toggleRecording(): void {
  if (session.state.status === 'recording' || session.state.status === 'countdown') {
    session.requestStop()
  } else if (session.state.status === 'idle' || session.state.status === 'done' || session.state.status === 'error') {
    const s = getSettings()
    void startRecording({ mode: s.lastMode, displayId: s.lastDisplayId ?? undefined })
  }
}

const trayActions: TrayActions = {
  recordScreen: () => void startRecording({ mode: 'screen', displayId: getSettings().lastDisplayId ?? undefined }),
  recordRegion: () => void startRecording({ mode: 'region' }),
  stop: () => session.requestStop(),
  open: () => showMainWindow(),
  settings: () => {
    showMainWindow()
    broadcast('navigate', 'settings')
  }
}

function registerShortcut(settings: Settings): void {
  globalShortcut.unregisterAll()
  if (!settings.shortcut) return
  try {
    const ok = globalShortcut.register(settings.shortcut, toggleRecording)
    if (!ok) console.warn('shortcut not registered:', settings.shortcut)
  } catch (e) {
    console.warn('invalid shortcut', settings.shortcut, e)
  }
}

const autotestState = setupAutotest((req) => startRecording(req), () => session.requestStop())

app.whenReady().then(() => {
  const settings = getSettings()
  registerIpc({ session, startRecording })
  onSettingsApplied((s, patch) => {
    if ('shortcut' in patch) registerShortcut(s)
    void refreshTray()
  })

  applyDockVisibility(settings.showInDock)
  // When launched as a login item the app can live in the menu bar only.
  const openedAtLogin = process.platform === 'darwin' && app.isPackaged && app.getLoginItemSettings().wasOpenedAtLogin
  createMainWindow({ show: !(openedAtLogin && settings.startHiddenAtLogin) })
  createTray(trayActions)
  registerShortcut(settings)
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
