import { app, globalShortcut } from 'electron'
import type { AppState, RecordingRequest, Settings } from '../shared/types'
import { onSettingsApplied } from './apply-settings'
import { setupAutotest } from './autotest'
import { registerIpc } from './ipc'
import { RecordingSession } from './session'
import { getSettings, updateSettings } from './settings'
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
  })

  createMainWindow({ show: true })
  registerShortcut(settings)
})

app.on('second-instance', () => showMainWindow())
app.on('activate', () => showMainWindow())
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => {
  setQuitting()
  globalShortcut.unregisterAll()
})
