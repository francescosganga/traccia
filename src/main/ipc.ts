import { app, dialog, ipcMain, screen, shell } from 'electron'
import type { DisplayInfo, EngineStartedInfo, RecordingRequest, Settings, WhisperModelId } from '../shared/types'
import { applySettings } from './apply-settings'
import { getPermissions, openPrivacySettings, requestPermission } from './permissions'
import { listRecordings } from './recordings'
import type { RecordingSession } from './session'
import { getSettings } from './settings'
import * as whisper from './whisper'
import { broadcast, getMainWindow, resolveRegion, showMainWindow } from './windows'

export interface IpcDeps {
  session: RecordingSession
  startRecording: (req: RecordingRequest) => Promise<void>
}

export function listDisplays(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay()
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `Schermo ${i + 1}`,
    bounds: d.bounds,
    scaleFactor: d.scaleFactor,
    primary: d.id === primary.id
  }))
}

export function registerIpc({ session, startRecording }: IpcDeps): void {
  // settings
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:update', (_e, patch: Partial<Settings>) => applySettings(patch))
  ipcMain.handle('dialog:chooseDir', async (_e, current: string) => {
    const win = getMainWindow()
    const res = await dialog.showOpenDialog(win!, { defaultPath: current, properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })

  // system
  ipcMain.handle('displays:list', () => listDisplays())
  ipcMain.handle('permissions:get', () => getPermissions())
  ipcMain.handle('permissions:request', (_e, kind) => requestPermission(kind))
  ipcMain.handle('permissions:open', (_e, kind) => openPrivacySettings(kind))
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:platform', () => process.platform)

  // whisper models
  ipcMain.handle('whisper:models', () => whisper.listModels())
  ipcMain.handle('whisper:dir', () => whisper.modelsDir())
  ipcMain.handle('whisper:download', async (_e, id: WhisperModelId) => {
    try {
      await whisper.downloadModel(id, (progress, file) => broadcast('whisper:progress', { model: id, status: 'progress', progress, file }))
      broadcast('whisper:progress', { model: id, status: 'done', progress: 1 })
    } catch (e) {
      const msg = (e as Error).message
      broadcast('whisper:progress', { model: id, status: msg === 'cancelled' ? 'cancelled' : 'error', progress: 0, error: msg })
      if (msg !== 'cancelled') throw e
    }
  })
  ipcMain.handle('whisper:cancel', (_e, id: WhisperModelId) => whisper.cancelDownload(id))
  ipcMain.handle('whisper:delete', (_e, id: WhisperModelId) => whisper.deleteModel(id))
  ipcMain.handle('whisper:deleteAll', () => whisper.deleteAllModels())

  // recording
  ipcMain.handle('recording:state', () => session.state)
  ipcMain.handle('recording:start', (_e, req: RecordingRequest) => startRecording(req))
  ipcMain.handle('recording:stop', () => session.requestStop())
  ipcMain.handle('recording:reset', () => session.reset())
  ipcMain.on('region:confirm', (_e, selection) => resolveRegion(selection))
  ipcMain.on('region:cancel', () => resolveRegion(null))

  // engine (renderer → main)
  ipcMain.on('engine:started', (_e, info: EngineStartedInfo) => session.onEngineStarted(info))
  ipcMain.on('engine:chunk', (_e, chunk: ArrayBuffer) => session.onEngineChunk(chunk))
  ipcMain.on('engine:stopped', () => void session.onEngineStopped())
  ipcMain.on('engine:error', (_e, message: string) => session.onEngineError(message))

  // recordings
  ipcMain.handle('recordings:list', () => listRecordings(getSettings().outputDir))
  ipcMain.handle('recordings:showInFolder', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('recordings:open', (_e, p: string) => shell.openPath(p))
  ipcMain.handle('window:show', () => showMainWindow())
}
