import { app, globalShortcut, ipcMain } from 'electron'
import type { AppState, RecordingRequest, Settings } from '../shared/types'
import { applyDockVisibility, onSettingsApplied } from './apply-settings'
import { setupAutotest } from './autotest'
import { notifyControlState, startControlServer, stopControlServer } from './control'
import { registerIpc } from './ipc'
import { handleMediaProtocol, registerMediaScheme } from './media-protocol'
import { rememberLaunchPermissions } from './permissions'
import { setupScreenshots, useScreenshotProfile } from './screenshots'
import { activities } from './activity'
import { DictationSession } from './dictation'
import { t } from '../shared/i18n'
import { RecordingSession } from './session'
import { getSettings, updateSettings } from './settings'
import { createTray, refreshTray, updateTray, type TrayActions } from './tray'
import { cancelDiarization, cancelSpeakerDownload } from './speakers'
import { cleanupLegacyModels, killWorker } from './whisper'
import {
  broadcast,
  createMainWindow,
  getMainWindow,
  hideControls,
  hideMainWindow,
  hideRegionFrame,
  hideWebcamBubble,
  selectRegion,
  setQuitting,
  showControls,
  showMainWindow,
  showRegionFrame,
  showWebcamBubble,
  updateWebcamBubble
} from './windows'

app.setName('Traccia')
// System audio on macOS: Chromium hands the loopback to getDisplayMedia, through ScreenCaptureKit,
// only behind these features (macOS 13+). The Screen Recording permission covers it.
if (process.platform === 'darwin') app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride')
// A separate profile (settings, socket, single-instance lock): for running a development
// build next to the installed app, and for the CLI tests.
if (process.env.TRACCIA_USER_DATA) app.setPath('userData', process.env.TRACCIA_USER_DATA)
// Before the lock: it is tied to userData, so a screenshot run on its own profile can coexist with the running app
useScreenshotProfile()
registerMediaScheme()
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let recordingRelease: (() => void) | null = null
let recordingStarting = false
let dictation: DictationSession | null = null
let dictationShortcutRegistered = false

const session = new RecordingSession({
  engine: () => getMainWindow()?.webContents ?? null,
  showControls,
  hideControls,
  showRegionFrame,
  hideRegionFrame,
  showWebcam: showWebcamBubble,
  updateWebcam: updateWebcamBubble,
  hideWebcam: hideWebcamBubble,
  hideMainWindow,
  showMainWindow,
  onState: (state: AppState) => {
    if (!recordingStarting && ['idle', 'done', 'error'].includes(state.status)) { recordingRelease?.(); recordingRelease = null }
    broadcast('state', state)
    void updateTray(state)
    notifyControlState(state)
    autotestState(state)
  }
})

/** Entry point for every "start recording" request (UI, tray, shortcut). */
async function startRecording(req: RecordingRequest): Promise<void> {
  const release = activities.acquire('recording')
  if (!release) {
    if (!session.isBusy && session.state.status !== 'selecting') {
      session.setState({ status: 'error', message: t('dictation.activityBusy') })
      showMainWindow()
    }
    throw new Error(t('dictation.activityBusy'))
  }
  recordingRelease = release
  recordingStarting = true
  try { await beginRecording(req) }
  catch (error) {
    release()
    if (recordingRelease === release) recordingRelease = null
    throw error
  } finally {
    recordingStarting = false
    if (['idle', 'done', 'error'].includes(session.state.status)) {
      release()
      if (recordingRelease === release) recordingRelease = null
    }
  }
}

async function beginRecording(req: RecordingRequest): Promise<void> {
  if ((req.overrides?.format ?? getSettings().format) === 'm4a') req = { ...req, mode: 'screen', region: undefined }
  updateSettings({ lastMode: req.mode, lastDisplayId: req.displayId ?? null })
  if (req.mode === 'region' && !req.region) {
    session.setState({ status: 'selecting' })
    hideMainWindow()
    const selection = await selectRegion()
    if (!selection) {
      session.setState({ status: 'idle' })
      showMainWindow()
      return
    }
    req = { ...req, displayId: selection.displayId, region: selection.rect }
  }
  await session.start(req)
}

const recordScreen = (): void => void startRecording({ mode: 'screen', displayId: getSettings().lastDisplayId ?? undefined }).catch((error) => console.error('start recording failed', error))
const recordRegion = (): void => void startRecording({ mode: 'region' }).catch((error) => console.error('start recording failed', error))

/** A shortcut stops the recording in progress, otherwise it starts one. */
function stopOrStart(start: () => void): () => void {
  return () => {
    const { status } = session.state
    if (status === 'recording' || status === 'countdown') session.requestStop()
    else if (status === 'idle' || status === 'done' || status === 'error') start()
  }
}

const trayActions: TrayActions = {
  dictate: () => { void dictation?.open().catch((error) => console.error('open dictation failed', error)) },
  dictationActive: () => dictation?.active ?? false,
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
  const bindings: [string, () => void][] = []
  if (settings.shortcutsEnabled) bindings.push(
    [settings.shortcutScreen, stopOrStart(recordScreen)],
    [settings.shortcutRegion, stopOrStart(recordRegion)]
  )
  const dictate = () => { void dictation?.toggle().catch((error) => console.error('dictation shortcut failed', error)) }
  dictationShortcutRegistered = false
  if (settings.dictationShortcutEnabled) bindings.push([settings.dictationShortcut, dictate])
  const registered = new Set<string>()
  for (const [accelerator, handler] of bindings) {
    if (!accelerator) continue
    try {
      const normalized = accelerator.toLowerCase().replace('commandorcontrol', process.platform === 'darwin' ? 'command' : 'control').split('+').sort().join('+')
      const ok = !registered.has(normalized) && globalShortcut.register(accelerator, handler)
      if (ok) registered.add(normalized)
      if (handler === dictate) dictationShortcutRegistered = ok
      if (!ok) console.warn('shortcut not registered:', accelerator)
    } catch (e) {
      console.warn('invalid shortcut', accelerator, e)
    }
  }
  broadcast('dictation:shortcutStatus', dictationShortcutRegistered)
}

const autotestState = setupAutotest((req) => startRecording(req), () => session.requestStop())

app.whenReady().then(() => {
  const settings = getSettings()
  rememberLaunchPermissions()
  dictation = new DictationSession(() => { void refreshTray() })
  dictation.registerIpc()
  ipcMain.handle('dictation:shortcutStatus', () => dictationShortcutRegistered)
  ipcMain.handle('dictation:settings', () => { showMainWindow(); broadcast('navigate', 'dictation') })
  handleMediaProtocol()
  registerIpc({ session, startRecording, suspendShortcuts: (off) => (off ? globalShortcut.unregisterAll() : registerShortcuts(getSettings())) })
  startControlServer({ session, startRecording })
  onSettingsApplied((s, patch) => {
    if ('shortcutsEnabled' in patch || 'shortcutScreen' in patch || 'shortcutRegion' in patch || 'dictationShortcutEnabled' in patch || 'dictationShortcut' in patch) registerShortcuts(s)
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
  stopControlServer()
  dictation?.dispose()
  killWorker()
  cancelDiarization()
  cancelSpeakerDownload()
})
