import { desktopCapturer, screen, session as electronSession, systemPreferences, type Display, type WebContents } from 'electron'
import { createWriteStream, type WriteStream } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import type {
  AppState,
  ClickEvent,
  CursorSample,
  EngineStartedInfo,
  OutputFormat,
  ProcessingProgress,
  RecordingRequest,
  RecordingResult,
  Rect
} from '../shared/types'
import { t } from '../shared/i18n'
import { CursorTracker } from './cursor'
import { h264Encoder, h264EncoderArgs, runFfmpeg } from './ffmpeg'
import { getPermissions, openPrivacySettings } from './permissions'
import { getSettings } from './settings'
import { buildTimeline, mapPoint, type Geometry } from './timeline'

export interface SessionHost {
  /** WebContents of the hidden main window, where the MediaRecorder engine lives */
  engine(): WebContents | null
  showControls(display: Display): void
  hideControls(): void
  hideMainWindow(): void
  showMainWindow(): void
  onState(state: AppState): void
}

const FRAME_RATE = 30
const ENGINE_START_TIMEOUT = 20_000

function timestampName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2)

export class RecordingSession {
  state: AppState = { status: 'idle' }
  private tracker = new CursorTracker()
  private display: Display | null = null
  private region: Rect | null = null
  private dir = ''
  private rawPath = ''
  private file: WriteStream | null = null
  private info: EngineStartedInfo | null = null
  private startedAtDate = new Date()
  private stoppedAt = 0
  private startTimer: NodeJS.Timeout | null = null
  private countdownAbort = false

  constructor(private host: SessionHost) {}

  private setState(state: AppState): void {
    this.state = state
    this.host.onState(state)
  }

  private progress(p: ProcessingProgress): void {
    this.setState({ status: 'processing', ...p })
  }

  get isBusy(): boolean {
    return this.state.status === 'countdown' || this.state.status === 'recording' || this.state.status === 'processing'
  }

  reset(): void {
    if (this.state.status === 'done' || this.state.status === 'error' || this.state.status === 'idle' || this.state.status === 'selecting') {
      this.setState({ status: 'idle' })
    }
  }

  /** Starts a recording. For region mode the region must already be chosen. */
  async start(req: RecordingRequest): Promise<void> {
    if (this.isBusy) return
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('screen')
      if (status === 'denied' || status === 'restricted') {
        openPrivacySettings('screen')
        this.host.showMainWindow()
        this.setState({ status: 'error', message: t('err.screenPermission') })
        return
      }
    }
    const settings = getSettings()
    const displays = screen.getAllDisplays()
    this.display = displays.find((d) => d.id === req.displayId) ?? screen.getPrimaryDisplay()
    this.region = req.mode === 'region' && req.region ? req.region : null
    this.info = null
    this.startedAtDate = new Date()
    this.dir = join(settings.outputDir, timestampName(this.startedAtDate))
    await mkdir(this.dir, { recursive: true })
    this.rawPath = join(this.dir, 'raw.webm')
    this.file = createWriteStream(this.rawPath)

    const engine = this.host.engine()
    if (!engine) {
      this.fail(t('err.noMainWindow'))
      return
    }

    // Tell Chromium which screen to hand to getDisplayMedia() in the renderer.
    const displayId = String(this.display.id)
    electronSession.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        const source = sources.find((s) => s.display_id === displayId) ?? sources[0]
        if (!source) throw new Error('no screen source available')
        callback({ video: source })
      } catch (e) {
        console.error('display media request failed', e)
        // Rejecting the request makes getDisplayMedia() throw NotAllowedError in the renderer.
        callback({})
      }
    })

    this.host.hideMainWindow()
    if (settings.showControls) this.host.showControls(this.display)

    this.countdownAbort = false
    for (let s = settings.countdown; s > 0; s--) {
      this.setState({ status: 'countdown', seconds: s })
      await new Promise((r) => setTimeout(r, 1000))
      if (this.countdownAbort) {
        await this.cleanupAborted()
        return
      }
    }

    const perms = getPermissions()
    this.tracker.start(settings.trackClicks && perms.accessibility)
    if (settings.trackClicks && !perms.accessibility) {
      this.tracker.warnings.push(t('warn.clicksNoAccessibility'))
    }

    this.setState({ status: 'countdown', seconds: 0 })
    engine.send('engine:start', { audio: settings.audio, frameRate: FRAME_RATE })
    this.startTimer = setTimeout(() => {
      if (this.state.status === 'countdown') this.fail(t('err.engineTimeout'))
    }, ENGINE_START_TIMEOUT)
  }

  private async cleanupAborted(): Promise<void> {
    this.host.hideControls()
    this.file?.close()
    this.file = null
    await rm(this.dir, { recursive: true, force: true }).catch(() => {})
    this.setState({ status: 'idle' })
    this.host.showMainWindow()
  }

  /** Stop requested by the user (tray, shortcut, widget). */
  requestStop(): void {
    if (this.state.status === 'countdown') {
      this.countdownAbort = true
      if (this.state.seconds === 0) this.host.engine()?.send('engine:stop')
      return
    }
    if (this.state.status === 'recording') this.host.engine()?.send('engine:stop')
  }

  // ---- events coming from the renderer engine --------------------------------

  onEngineStarted(info: EngineStartedInfo): void {
    if (this.startTimer) clearTimeout(this.startTimer)
    this.startTimer = null
    this.info = info
    this.setState({ status: 'recording', startedAt: info.t0 })
  }

  onEngineChunk(chunk: ArrayBuffer | Buffer): void {
    this.file?.write(Buffer.from(chunk as ArrayBuffer))
  }

  async onEngineStopped(): Promise<void> {
    this.stoppedAt = Date.now()
    const tracking = this.tracker.stop()
    this.host.hideControls()
    await new Promise<void>((resolve) => (this.file ? this.file.end(resolve) : resolve()))
    this.file = null
    this.host.showMainWindow()
    if (!this.info) {
      // stopped during countdown / before the first frame
      await rm(this.dir, { recursive: true, force: true }).catch(() => {})
      this.setState({ status: 'idle' })
      return
    }
    try {
      const result = await this.process(tracking)
      this.setState({ status: 'done', result })
    } catch (e) {
      console.error('processing failed', e)
      this.setState({ status: 'error', message: t('err.processing', { error: (e as Error).message, path: this.rawPath }) })
    }
  }

  onEngineError(message: string): void {
    this.fail(message)
  }

  private fail(message: string): void {
    if (this.startTimer) clearTimeout(this.startTimer)
    this.tracker.stop()
    this.host.hideControls()
    this.file?.close()
    this.file = null
    this.host.showMainWindow()
    this.setState({ status: 'error', message })
  }

  // ---- post processing ---------------------------------------------------------

  private geometry(): Geometry {
    const info = this.info!
    const display = this.display!
    const scale = info.width / display.bounds.width
    let cropPx: Rect = { x: 0, y: 0, width: info.width, height: info.height }
    if (this.region) {
      const x = Math.max(0, Math.round(this.region.x * scale))
      const y = Math.max(0, Math.round(this.region.y * scale))
      cropPx = {
        x,
        y,
        width: even(Math.min(info.width - x, Math.round(this.region.width * scale))),
        height: even(Math.min(info.height - y, Math.round(this.region.height * scale)))
      }
    }
    const targetH = { native: cropPx.height, '1080': 1080, '720': 720, '480': 480 }[getSettings().resolution]
    let outWidth = cropPx.width
    let outHeight = cropPx.height
    if (targetH < cropPx.height) {
      outHeight = even(targetH)
      outWidth = even(Math.round((cropPx.width * outHeight) / cropPx.height))
    }
    return { displayBounds: display.bounds, scale, cropPx, outScale: outWidth / cropPx.width, outWidth, outHeight }
  }

  private async process(tracking: { samples: CursorSample[]; clicks: ClickEvent[]; warnings: string[] }): Promise<RecordingResult> {
    const settings = getSettings()
    const info = this.info!
    const durationMs = this.stoppedAt - info.t0
    const warnings = [...tracking.warnings]
    const g = this.geometry()
    const format: OutputFormat = settings.format

    const filters: string[] = []
    if (this.region) filters.push(`crop=${g.cropPx.width}:${g.cropPx.height}:${g.cropPx.x}:${g.cropPx.y}`)
    if (g.outWidth !== g.cropPx.width) filters.push(`scale=${g.outWidth}:${g.outHeight}`)

    const mediaPath = join(this.dir, `recording.${format}`)
    const convertStep = t('step.convert', { format: format.toUpperCase() })
    this.progress({ step: convertStep, progress: 0 })
    const args = ['-i', this.rawPath]
    if (filters.length) args.push('-vf', filters.join(','))
    if (format === 'webm') {
      if (filters.length) args.push('-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-crf', '32', '-b:v', '0', '-c:a', 'libopus')
      else args.push('-c', 'copy')
    } else {
      const canCopy = !filters.length && /h264|avc1/i.test(info.mimeType)
      if (canCopy) args.push('-c:v', 'copy')
      else args.push(...h264EncoderArgs(await h264Encoder(), g.outWidth, g.outHeight))
      args.push('-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart')
    }
    args.push(mediaPath)
    await runFfmpeg(args, { durationMs, onProgress: (p) => this.progress({ step: convertStep, progress: p }) })

    this.progress({ step: t('step.timeline'), progress: -1 })
    const txtPath = join(this.dir, 'recording.txt')
    const rawTxtPath = join(this.dir, 'recording-raw.txt')
    const jsonPath = join(this.dir, 'recording.json')
    const timelineInput = {
      createdAt: this.startedAtDate,
      format,
      mediaName: `recording.${format}`,
      width: g.outWidth,
      height: g.outHeight,
      fps: FRAME_RATE,
      durationMs,
      audio: settings.audio && info.hasAudio,
      t0: info.t0,
      samples: tracking.samples,
      clicks: tracking.clicks,
      cursorHz: settings.cursorHz,
      geometry: g,
      warnings
    }
    // recording.txt: clicks, speech and frames. recording-raw.txt: the same plus pointer movement.
    await writeFile(txtPath, buildTimeline({ ...timelineInput, cursorMode: 'clicks' }), 'utf8')
    await writeFile(rawTxtPath, buildTimeline({ ...timelineInput, cursorMode: 'full' }), 'utf8')

    const json = {
      version: 1,
      app: 'traccia',
      createdAt: this.startedAtDate.toISOString(),
      format,
      media: `recording.${format}`,
      timeline: 'recording.txt',
      rawTimeline: 'recording-raw.txt',
      width: g.outWidth,
      height: g.outHeight,
      fps: FRAME_RATE,
      durationMs,
      display: { id: this.display!.id, bounds: this.display!.bounds, scaleFactor: this.display!.scaleFactor },
      capture: { width: info.width, height: info.height, mimeType: info.mimeType },
      region: this.region,
      cropPx: g.cropPx,
      audio: settings.audio && info.hasAudio,
      /** [ms, x, y] in output pixels, full sample rate */
      cursor: tracking.samples
        .filter((s) => s.t >= info.t0 && s.t <= this.stoppedAt)
        .map((s) => {
          const p = mapPoint(g, s.x, s.y)
          return [s.t - info.t0, p.x, p.y]
        }),
      clicks: tracking.clicks
        .filter((c) => c.t >= info.t0 && c.t <= this.stoppedAt)
        .map((c) => {
          const p = mapPoint(g, c.x, c.y)
          return { t: c.t - info.t0, button: c.button, x: p.x, y: p.y }
        }),
      warnings
    }
    await writeFile(jsonPath, JSON.stringify(json), 'utf8')
    await rm(this.rawPath, { force: true })

    return {
      dir: this.dir,
      mediaPath,
      txtPath,
      rawTxtPath,
      jsonPath,
      durationMs,
      format,
      width: g.outWidth,
      height: g.outHeight,
      warnings
    }
  }
}

