import { app, BrowserWindow, clipboard, ipcMain, powerMonitor, screen } from 'electron'
import { createWriteStream, type WriteStream } from 'fs'
import { mkdir, mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { activities } from './activity'
import { runFfmpeg } from './ffmpeg'
import { getPermissions } from './permissions'
import { getSettings } from './settings'
import { broadcast } from './windows'
import { TextInsertion } from './text-insertion'
import { isModelInstalled, killWorker, transcribe } from './whisper'
import { t } from '../shared/i18n'
import { DICTATION_MAX_MS, DICTATION_MAX_TEXT, dictationActive, type DictationPreferences, type DictationState } from '../shared/dictation'

export class DictationSession {
  state: DictationState = { phase: 'ready', text: '', target: null, message: '', warning: '', startedAt: null, retry: false }
  private window: BrowserWindow | null = null
  private loading: Promise<void> | null = null
  private insertion = new TextInsertion()
  private id = 0
  private captureId: number | null = null
  private file: WriteStream | null = null
  private dir = ''
  private bytes = 0
  private release: (() => void) | null = null
  private timer: NodeJS.Timeout | null = null
  private abort: AbortController | null = null
  private preferences: DictationPreferences | null = null
  private tempRoot = join(app.getPath('userData'), 'dictation-tmp')
  private initialized: Promise<unknown> | null = null
  private cancelling: Promise<void> | null = null
  private dismissTimer: NodeJS.Timeout | null = null
  private expanded = false
  private displayId: number | null = null

  constructor(private changed: () => void) {
    powerMonitor.on('suspend', () => {
      if (this.state.phase === 'listening') {
        this.set({ warning: t('dictation.interrupted') })
        this.stop()
      } else if (this.state.phase === 'preparing') void this.cancel()
    })
  }

  get active(): boolean { return dictationActive(this.state.phase) }

  private set(patch: Partial<DictationState>): void {
    const changedPhase = patch.phase !== undefined && patch.phase !== this.state.phase
    this.state = { ...this.state, ...patch }
    broadcast('dictation:state', this.state)
    if (changedPhase) {
      this.layout()
      this.changed()
    }
  }

  private layout(): void {
    if (!this.window) return
    const display = screen.getAllDisplays().find((item) => item.id === this.displayId) ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const area = display.workArea
    const compact = this.active || this.state.phase === 'done'
    const width = compact ? 304 : 380
    const height = compact ? 80 : this.expanded ? 430 : 260
    this.window.setBounds({ width, height, x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + area.height - height - 12) })
  }

  private clearDismiss(): void {
    if (this.dismissTimer) clearTimeout(this.dismissTimer)
    this.dismissTimer = null
  }

  private hide(): void {
    this.window?.hide()
    if (getSettings().showInDock) void app.dock?.show()
  }

  private async show(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      this.displayId = display.id
      const win = new BrowserWindow({
        width: 304, height: 80, frame: false, transparent: true, hasShadow: false,
        resizable: false, minimizable: false, maximizable: false, skipTaskbar: true, acceptFirstMouse: true,
        title: t('dictation.title'), show: false, fullscreenable: false,
        webPreferences: { preload: join(__dirname, '../preload/index.js'), backgroundThrottling: false }
      })
      this.window = win
      this.layout()
      win.setAlwaysOnTop(true, 'floating')
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      win.on('close', (event) => {
        event.preventDefault()
        void this.closePanel()
      })
      win.webContents.on('render-process-gone', () => {
        if (this.active || this.state.retry) void this.cancel()
        this.window = null
        this.loading = null
        win.destroy()
      })
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      const url = process.env.ELECTRON_RENDERER_URL
      this.loading = url ? win.loadURL(`${url}/dictation.html`) : win.loadFile(join(__dirname, '../renderer/dictation.html'))
    }
    await this.loading
    // The caret stays in the source app while the microphone is listening.
    this.window?.showInactive()
  }

  /** Failed deliveries stay recoverable; a successful delivery starts a fresh take next time. */
  async open(): Promise<void> {
    if (this.active || (this.state.phase !== 'done' && (this.state.text || this.state.retry))) { await this.show(); return }
    await this.start(true)
  }

  async toggle(): Promise<void> {
    if (this.state.phase === 'listening') this.stop()
    else await this.open()
  }

  async start(captureTarget = false): Promise<void> {
    if (this.active) return
    this.clearDismiss()
    const release = activities.acquire('dictation')
    if (!release) {
      console.warn('dictation start blocked', { activity: activities.current, phase: this.state.phase })
      this.set({ phase: 'error', text: this.state.phase === 'done' ? '' : this.state.text, message: this.busyMessage() })
      await this.show()
      return
    }
    this.release = release
    const id = ++this.id
    this.expanded = false
    this.displayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
    try {
      this.set({ phase: 'preparing', text: '', message: '', warning: '', retry: false, startedAt: null })
      if (captureTarget || !this.state.target?.token) {
        const target = await this.insertion.capture()
        if (id !== this.id) return
        this.set({ target })
      }
      await this.show()
      if (id !== this.id) return
      const s = getSettings()
      this.preferences = { mic: s.dictationMic, model: s.dictationModel, language: s.dictationLanguage }
      if (getPermissions().microphone !== 'granted') {
        this.finish({ phase: 'ready', message: t('dictation.microphoneRequired') })
        return
      }
      if (!isModelInstalled(s.dictationModel)) {
        this.finish({ phase: 'ready', message: t('dictation.modelRequired') })
        return
      }
      this.initialized ??= rm(this.tempRoot, { recursive: true, force: true }).then(() => mkdir(this.tempRoot, { recursive: true }))
      await this.initialized
      await this.removeAudio()
      if (id !== this.id) return
      const dir = await mkdtemp(join(this.tempRoot, 'take-'))
      if (id !== this.id) { await rm(dir, { recursive: true, force: true }); return }
      this.dir = dir
      this.bytes = 0
      this.file = createWriteStream(join(dir, 'audio.webm'), { mode: 0o600 })
      this.captureId = id
      this.file.on('error', (error) => { if (id === this.id && id === this.captureId) void this.fail(error) })
      this.window?.webContents.send('dictation:capture', { id, mic: this.preferences.mic })
      this.timer = setTimeout(() => void this.fail(new Error('microphone startup timed out')), 20_000)
    } catch (error) { if (id === this.id) await this.fail(error) }
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private busyMessage(): string {
    const activity = activities.current
    return t(activity ? `dictation.busy.${activity}` : 'dictation.busy')
  }

  private finish(patch: Partial<DictationState>): void {
    this.clearTimer()
    this.release?.()
    this.release = null
    this.set(patch)
  }

  private async removeAudio(): Promise<void> {
    const dir = this.dir
    this.dir = ''
    if (dir) await rm(dir, { recursive: true, force: true }).catch((error) => console.error('dictation cleanup failed', error))
  }

  private async fail(error: unknown): Promise<void> {
    console.error('dictation failed', error)
    await this.cancel()
    this.set({ phase: 'error', message: t('dictation.captureFailed') })
  }

  stop(): void {
    if (this.state.phase !== 'listening') return
    this.clearTimer()
    this.set({ phase: 'stopping' })
    this.window?.webContents.send('dictation:stop', this.id)
    this.timer = setTimeout(() => void this.fail(new Error('microphone stop timed out')), 10_000)
  }

  async cancel(): Promise<void> {
    if (this.state.phase === 'inserting') return
    if (this.cancelling) return this.cancelling
    this.clearDismiss()
    ++this.id
    this.captureId = null
    this.clearTimer()
    this.window?.webContents.send('dictation:cancel')
    this.abort?.abort()
    this.abort = null
    if (this.state.phase === 'transcribing' && this.release) killWorker()
    this.file?.destroy()
    this.file = null
    this.set({ phase: 'stopping' })
    // Hold ownership until cleanup finishes, including repeated Cancel/Close commands.
    this.cancelling = this.removeAudio().then(() => {
      this.finish({ phase: this.state.text ? 'result' : 'ready', message: '', warning: '', retry: false, startedAt: null })
    }).finally(() => { this.cancelling = null })
    return this.cancelling
  }

  async closePanel(): Promise<void> {
    if (this.state.phase === 'inserting') return
    if (this.active || this.state.retry) await this.cancel()
    this.clearDismiss()
    this.hide()
  }

  private async recognize(id: number): Promise<void> {
    if (!this.preferences || !this.dir) return
    this.set({ phase: 'transcribing', message: '', retry: false })
    const dir = this.dir
    const controller = new AbortController()
    this.abort = controller
    try {
      await runFfmpeg(['-i', join(dir, 'audio.webm'), '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-acodec', 'pcm_f32le', join(dir, 'audio.f32')], { signal: controller.signal })
      if (id !== this.id) return
      const result = await transcribe(join(dir, 'audio.f32'), this.preferences.model, this.preferences.language, () => {})
      if (id !== this.id) return
      const text = result.segments.map((segment) => segment.text.trim()).filter(Boolean).join(' ')
      await this.removeAudio()
      if (id !== this.id) return
      if (text && this.state.target?.token) {
        // Keep the compact badge and worker lease through delivery, without flashing a preview.
        this.set({ text, retry: false })
        await this.insert(true)
      } else this.finish({ phase: 'result', text, message: t(text ? 'dictation.recover' : 'dictation.noSpeech'), retry: false })
    } catch (error) {
      if (id !== this.id) return
      console.error('dictation transcription failed', error)
      this.finish({ phase: 'error', message: t('dictation.transcriptionFailed'), retry: true })
    } finally {
      if (this.abort === controller) this.abort = null
      await rm(join(dir, 'audio.f32'), { force: true }).catch(() => {})
    }
  }

  async retry(): Promise<void> {
    if (!this.state.retry || this.active) return
    const release = activities.acquire('dictation')
    if (!release) { this.set({ message: this.busyMessage() }); return }
    this.release = release
    await this.recognize(++this.id)
  }

  private setText(text: unknown): void {
    if (this.active || typeof text !== 'string' || text.length > DICTATION_MAX_TEXT) return
    this.set({ text, message: '' })
  }

  async insert(automatic = false): Promise<void> {
    const { text, target } = this.state
    const fromTranscription = automatic && this.state.phase === 'transcribing'
    if ((this.active && !fromTranscription) || !text.trim() || !target?.token) return
    const release = fromTranscription ? this.release : activities.acquire('dictation')
    if (!release) { this.set({ message: this.busyMessage() }); return }
    this.release = release
    let sent = false
    try {
      this.set({ phase: 'inserting', message: '' })
      sent = await this.insertion.insert(target.token, text, automatic)
    }
    catch (error) { console.error('dictation insertion failed', error) }
    finally {
      release()
      if (this.release === release) this.release = null
    }
    this.set({ phase: sent ? 'done' : 'result', target: { ...target, token: undefined, reason: 'destination' }, message: t(sent ? 'dictation.pasteSent' : 'dictation.insertFailed') })
    // Hide only after the destination takes focus; hiding first can activate an unrelated app.
    if (!sent) await this.show()
    else {
      this.dismissTimer = setTimeout(() => { this.dismissTimer = null; this.hide() }, 650)
    }
  }

  registerIpc(): void {
    const trusted = (sender: Electron.WebContents) => sender === this.window?.webContents
    const capturing = (sender: Electron.WebContents, id: number) => trusted(sender) && id === this.id && id === this.captureId
    ipcMain.handle('dictation:state', () => this.state)
    ipcMain.handle('dictation:open', () => this.open())
    ipcMain.handle('dictation:action', async (event, action: string, text?: unknown) => {
      if (!trusted(event.sender)) return
      if (action === 'start') await this.start(true)
      if (action === 'stop') this.stop()
      if (action === 'cancel') { await this.cancel(); this.hide() }
      if (action === 'close') await this.closePanel()
      if (action === 'retry') await this.retry()
      if (action === 'text') this.setText(text)
      if (action === 'expand' && !this.active) { this.expanded = true; this.layout(); this.window?.show() }
      if (action === 'insert') { this.setText(text); await this.insert() }
      if (action === 'copy' && !this.active) {
        this.setText(text)
        clipboard.writeText(this.state.text)
        this.set({ message: t('dictation.copied') })
      }
      if (action === 'target' && !this.active) this.set({ target: await this.insertion.capture(), message: '' })
    })
    ipcMain.handle('dictation:chunk', async (event, id: number, chunk: ArrayBuffer) => {
      if (!capturing(event.sender, id) || !this.file || !(chunk instanceof ArrayBuffer)) return
      if (chunk.byteLength > 2_000_000 || this.bytes + chunk.byteLength > 20_000_000) { await this.fail(new Error('audio size limit')); return }
      this.bytes += chunk.byteLength
      const file = this.file
      await new Promise<void>((resolve, reject) => file.write(Buffer.from(chunk), (error) => error ? reject(error) : resolve()))
    })
    ipcMain.on('dictation:started', (event, id: number, info: { fallback: boolean; callQuality: boolean; micName: string }) => {
      if (!capturing(event.sender, id) || this.state.phase !== 'preparing') return
      this.clearTimer()
      this.set({ phase: 'listening', startedAt: Date.now(), warning: [info.fallback ? t('dictation.micFallback') : '', info.callQuality ? t('dictation.callQuality') : '', info.micName].filter(Boolean).join(' · ') })
      this.timer = setTimeout(() => { this.set({ warning: t('dictation.limit') }); this.stop() }, DICTATION_MAX_MS)
    })
    ipcMain.handle('dictation:stopped', async (event, id: number, interrupted: boolean) => {
      if (!capturing(event.sender, id) || !['listening', 'stopping'].includes(this.state.phase)) return
      // Consume the recorder once; its late errors/duplicate stops cannot change a delivered take.
      this.captureId = null
      this.clearTimer()
      if (interrupted) this.set({ warning: t('dictation.interrupted') })
      this.set({ phase: 'stopping' })
      const file = this.file
      this.file = null
      try {
        if (file) await new Promise<void>((resolve, reject) => { file.once('error', reject); file.end(resolve) })
        if (id === this.id) await this.recognize(id)
      } catch (error) { if (id === this.id) await this.fail(error) }
    })
    ipcMain.on('dictation:error', (event, id: number) => { if (capturing(event.sender, id)) void this.fail(new Error('renderer capture failed')) })
    ipcMain.on('dictation:empty', (event, id: number) => {
      if (capturing(event.sender, id) && this.state.phase === 'listening') {
        void this.cancel().then(() => { this.set({ message: t('dictation.noSpeech') }); this.hide() })
      }
    })
  }

  dispose(): void {
    this.clearDismiss()
    this.clearTimer()
    this.abort?.abort()
    this.file?.destroy()
    this.insertion.close()
    this.window?.destroy()
    this.window = null
    void this.removeAudio()
  }
}
