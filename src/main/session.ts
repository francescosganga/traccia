import { desktopCapturer, screen, session as electronSession, systemPreferences, type Display, type WebContents } from 'electron'
import { createWriteStream, type WriteStream } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import type {
  AppState,
  SideTrackKind,
  ClickEvent,
  CursorSample,
  EngineStartedInfo,
  OutputFormat,
  ProcessingProgress,
  RecordingInfo,
  RecordingOverrides,
  RecordingRequest,
  RecordingResult,
  Rect,
  Settings,
  TranscriptSegment,
  TranscriptWord
} from '../shared/types'
import { t } from '../shared/i18n'
import type { RecordingJson } from '../shared/recording-reader'
import type { WebcamLayout, WebcamLayoutEvent } from '../shared/webcam'
import { placeLayout, systemAudioFilter, webcamGraph, type PlacedLayout } from './compose'
import { CursorTracker } from './cursor'
import { SideTrack } from './side-track'
import { h264Encoder, h264EncoderArgs, maxVolume, runFfmpeg } from './ffmpeg'
import { extractFrames } from './frames'
import { getPermissions, openPrivacySettings, requestPermission } from './permissions'
import { getSettings } from './settings'
import { recordingTexts } from './texts'
import { clipToDuration, mapPoint, wordsAround, type Geometry } from './timeline'
import { isModelInstalled, killWorker, transcribe } from './whisper'

export interface SessionHost {
  /** WebContents of the hidden main window, where the MediaRecorder engine lives */
  engine(): WebContents | null
  showControls(display: Display): void
  hideControls(): void
  showRegionFrame(display: Display, rect: Rect): void
  hideRegionFrame(): void
  /** `area` is the recorded region, or the whole display, in DIP relative to the display */
  showWebcam(display: Display, area: Rect, layout: WebcamLayout): void
  updateWebcam(layout: WebcamLayout): void
  hideWebcam(): void
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

// Below this peak (dBFS) the system audio counts as silent: nothing played, or macOS handed over nothing
const SILENCE_DB = -80

const VP9_ARGS = ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-crf', '32', '-b:v', '0']

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
  private overrides: RecordingOverrides = {}
  private transcribing = false
  /** Tracks recorded beside the screen, each to its own file */
  private sides: Record<SideTrackKind, SideTrack> = { webcam: new SideTrack(), systemAudio: new SideTrack() }
  /** Shape, corner and visibility over time, ms from the start of the recording */
  private layout: WebcamLayoutEvent[] = []

  constructor(private host: SessionHost) {}

  /** Also used by the region selection flow in index.ts, which runs before start(). */
  setState(state: AppState): void {
    this.state = state
    this.host.onState(state)
  }

  private progress(p: ProcessingProgress): void {
    this.setState({ status: 'processing', ...p })
  }

  /** The saved settings, with the per-recording overrides of the current request on top. */
  private settings(): Settings {
    return { ...getSettings(), ...this.overrides }
  }

  /** The webcam is laid over a video: there is no video to lay it over in JPG mode. */
  private webcamWanted(): boolean {
    const s = this.settings()
    return s.webcam && s.format !== 'jpg'
  }

  /** What the widget shows while recording: the choices most often regretted afterwards. */
  private recordingInfo(): RecordingInfo {
    const s = this.settings()
    // Once the engine runs, whether the microphone and the webcam actually opened
    const audio = this.info ? this.info.hasAudio : s.audio
    const systemAudio = this.info ? this.info.hasSystemAudio : s.systemAudio
    const webcam = (this.info ? this.info.hasWebcam : this.webcamWanted()) ? this.currentLayout() : null
    return { mode: this.region ? 'region' : 'screen', format: s.format, jpgFps: s.jpgFps, audio, systemAudio, webcam }
  }

  private currentLayout(): WebcamLayout {
    const { shape, corner, visible } = this.layout[this.layout.length - 1]
    return { shape, corner, visible }
  }

  private hideOverlays(): void {
    this.host.hideControls()
    this.host.hideRegionFrame()
    this.host.hideWebcam()
  }

  private closeSideFiles(): void {
    for (const side of Object.values(this.sides)) side.close()
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
        // macOS also says 'denied' when it has never been asked (or the app was removed from
        // the list): without a request first, the pane opened below would not list Traccia.
        await requestPermission('screen')
        openPrivacySettings('screen')
        this.host.showMainWindow()
        this.setState({ status: 'error', message: t('err.screenPermission') })
        return
      }
    }
    this.overrides = req.overrides ?? {}
    const settings = this.settings()
    const displays = screen.getAllDisplays()
    this.display = displays.find((d) => d.id === req.displayId) ?? screen.getPrimaryDisplay()
    this.region = req.mode === 'region' && req.region ? req.region : null
    this.info = null
    this.startedAtDate = new Date()
    this.dir = join(settings.outputDir, timestampName(this.startedAtDate))
    await mkdir(this.dir, { recursive: true })
    this.rawPath = join(this.dir, 'raw.webm')
    this.file = createWriteStream(this.rawPath)
    const webcam = this.webcamWanted()
    if (webcam) this.sides.webcam.open(join(this.dir, 'webcam.webm'))
    else this.sides.webcam.clear()
    if (settings.systemAudio) this.sides.systemAudio.open(join(this.dir, 'system-audio.webm'))
    else this.sides.systemAudio.clear()
    if (webcam) {
      this.layout = [{ t: 0, shape: settings.webcamShape, corner: settings.webcamCorner, visible: true }]
    }

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
        // 'loopback' keeps the sound playing on the speakers while it is recorded
        callback(settings.systemAudio ? { video: source, audio: 'loopback' } : { video: source })
      } catch (e) {
        console.error('display media request failed', e)
        // Rejecting the request makes getDisplayMedia() throw NotAllowedError in the renderer.
        callback({})
      }
    })

    this.host.hideMainWindow()
    if (settings.showControls) this.host.showControls(this.display)
    if (this.region && settings.showRegionFrame) this.host.showRegionFrame(this.display, this.region)
    if (webcam) {
      const area = this.region ?? { x: 0, y: 0, width: this.display.bounds.width, height: this.display.bounds.height }
      this.host.showWebcam(this.display, area, this.layout[0])
    }

    this.countdownAbort = false
    for (let s = settings.countdown; s > 0; s--) {
      // Recomputed at every tick: the webcam layout can change from the widget meanwhile
      this.setState({ status: 'countdown', seconds: s, info: this.recordingInfo() })
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

    this.setState({ status: 'countdown', seconds: 0, info: this.recordingInfo() })
    engine.send('engine:start', { audio: settings.audio, micDevice: settings.micDevice, systemAudio: settings.systemAudio, webcam, webcamDevice: settings.webcamDevice, frameRate: FRAME_RATE })
    this.startTimer = setTimeout(() => {
      if (this.state.status === 'countdown') this.fail(t('err.engineTimeout'))
    }, ENGINE_START_TIMEOUT)
  }

  private async cleanupAborted(): Promise<void> {
    this.hideOverlays()
    this.file?.close()
    this.file = null
    this.closeSideFiles()
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

  /**
   * A change from the widget: the bubble follows at once, the video from this instant.
   * During the countdown nothing is recorded yet, so it replaces the starting layout.
   */
  setWebcamLayout(patch: Partial<WebcamLayout>): void {
    const live = this.state.status === 'recording' || this.state.status === 'countdown'
    if (!live || !this.layout.length || !this.recordingInfo().webcam) return
    const next = { ...this.currentLayout(), ...patch }
    const t = this.state.status === 'recording' && this.info ? Math.max(0, Date.now() - this.info.t0) : 0
    this.layout.push({ ...next, t })
    this.host.updateWebcam(next)
    // The widget shows the layout it gets back with the state
    if (this.state.status === 'recording' || this.state.status === 'countdown') this.setState({ ...this.state, info: this.recordingInfo() })
  }

  /** Gives up the transcription in progress; the recording is saved without it. */
  skipTranscription(): void {
    if (this.transcribing) killWorker()
  }

  // ---- events coming from the renderer engine --------------------------------

  onEngineStarted(info: EngineStartedInfo): void {
    if (this.startTimer) clearTimeout(this.startTimer)
    this.startTimer = null
    this.info = info
    this.setState({ status: 'recording', startedAt: info.t0, info: this.recordingInfo() })
  }

  onEngineChunk(chunk: ArrayBuffer | Buffer): void {
    this.file?.write(Buffer.from(chunk as ArrayBuffer))
  }

  onSideStarted(kind: SideTrackKind, t0: number): void {
    this.sides[kind].t0 = t0
  }

  onSideChunk(kind: SideTrackKind, chunk: ArrayBuffer | Buffer): void {
    this.sides[kind].write(chunk)
  }

  async onEngineStopped(): Promise<void> {
    this.stoppedAt = Date.now()
    const tracking = this.tracker.stop()
    this.hideOverlays()
    await new Promise<void>((resolve) => (this.file ? this.file.end(resolve) : resolve()))
    this.file = null
    await Promise.all(Object.values(this.sides).map((side) => side.end()))
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
    this.hideOverlays()
    this.file?.close()
    this.file = null
    this.closeSideFiles()
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
    const targetH = { native: cropPx.height, '1080': 1080, '720': 720, '480': 480 }[this.settings().resolution]
    let outWidth = cropPx.width
    let outHeight = cropPx.height
    if (targetH < cropPx.height) {
      outHeight = even(targetH)
      outWidth = even(Math.round((cropPx.width * outHeight) / cropPx.height))
    }
    return { displayBounds: display.bounds, scale, cropPx, outScale: outWidth / cropPx.width, outWidth, outHeight }
  }

  /** Extra inputs and the mapping of the audio: the screen's own track (the microphone), or that mixed with the system audio. */
  private audioPlan(systemAudio: boolean, input: number, durationMs: number): { inputs: string[]; filter: string | null; map: string } {
    if (!systemAudio) return { inputs: [], filter: null, map: '0:a?' }
    const filter = systemAudioFilter({ input, offset: this.sides.systemAudio.offset(this.info!.t0), withMic: this.info!.hasAudio, durationMs })
    return { inputs: ['-i', this.sides.systemAudio.path], filter, map: '[aout]' }
  }

  /** The screen alone, cropped and scaled; the video is copied without re-encoding when nothing changes. */
  private async convert(out: string, filters: string[], format: OutputFormat, g: Geometry, durationMs: number, systemAudio: boolean): Promise<void> {
    const step = t('step.convert', { format: format.toUpperCase() })
    this.progress({ step, progress: 0 })
    const audio = this.audioPlan(systemAudio, 1, durationMs)
    const args = ['-i', this.rawPath, ...audio.inputs]
    if (audio.filter) {
      // The audio needs a filter graph; the video joins it only when it is cropped or scaled
      const video = filters.length ? `[0:v]${filters.join(',')}[vout];` : ''
      args.push('-filter_complex', video + audio.filter, '-map', filters.length ? '[vout]' : '0:v', '-map', audio.map)
    } else if (filters.length) args.push('-vf', filters.join(','))
    if (format === 'webm') {
      args.push(...(filters.length ? VP9_ARGS : ['-c:v', 'copy']))
      args.push('-c:a', filters.length || audio.filter ? 'libopus' : 'copy')
    } else {
      const canCopy = !filters.length && /h264|avc1/i.test(this.info!.mimeType)
      if (canCopy) args.push('-c:v', 'copy')
      else args.push(...h264EncoderArgs(await h264Encoder(), g.outWidth, g.outHeight))
      args.push('-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart')
    }
    args.push(out)
    await runFfmpeg(args, { durationMs, onProgress: (p) => this.progress({ step, progress: p }) })
  }

  /** The screen with the webcam laid over it (graph from compose.ts); always re-encoded. */
  private async composeWebcam(graph: string, out: string, format: OutputFormat, g: Geometry, durationMs: number, systemAudio: boolean): Promise<void> {
    const step = t('step.webcam')
    this.progress({ step, progress: 0 })
    // The webcam recorder starts a few ms after the screen one (or before): shift it onto the screen's clock
    const offset = this.sides.webcam.offset(this.info!.t0).toFixed(3)
    const audio = this.audioPlan(systemAudio, 2, durationMs)
    const args = ['-i', this.rawPath, '-itsoffset', offset, '-i', this.sides.webcam.path, ...audio.inputs]
    args.push('-filter_complex', audio.filter ? `${graph};${audio.filter}` : graph, '-map', '[vout]', '-map', audio.map)
    if (format === 'webm') args.push(...VP9_ARGS, '-c:a', 'libopus')
    else args.push(...h264EncoderArgs(await h264Encoder(), g.outWidth, g.outHeight), '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart')
    args.push(out)
    await runFfmpeg(args, { durationMs, onProgress: (p) => this.progress({ step, progress: p }) })
  }

  private async process(tracking: {
    samples: CursorSample[]
    clicks: ClickEvent[]
    warnings: string[]
    clicksTracked: boolean
  }): Promise<RecordingResult> {
    const settings = this.settings()
    const info = this.info!
    const durationMs = this.stoppedAt - info.t0
    const warnings = [...tracking.warnings]
    if (settings.audio && !info.hasAudio) warnings.push(t('warn.micUnavailable'))
    if (info.micFallback && settings.micDevice) warnings.push(t('warn.micFallback', { name: settings.micDevice.label }))
    const g = this.geometry()
    const format: OutputFormat = settings.format

    const filters: string[] = []
    if (this.region) filters.push(`crop=${g.cropPx.width}:${g.cropPx.height}:${g.cropPx.x}:${g.cropPx.y}`)
    if (g.outWidth !== g.cropPx.width) filters.push(`scale=${g.outWidth}:${g.outHeight}`)

    // The webcam goes over the video only if it recorded something, and is shown at some point
    let graph: string | null = null
    let placed: PlacedLayout[] | null = null
    if (this.webcamWanted()) {
      const recorded = info.hasWebcam && (await this.sides.webcam.recorded())
      if (!recorded) warnings.push(t('warn.webcamUnavailable'))
      else graph = webcamGraph({ screenFilters: filters, layout: this.layout, width: g.outWidth, height: g.outHeight, durationMs })
      if (graph) placed = placeLayout(this.layout, g.outWidth, g.outHeight)
    }

    // The system audio joins the audio only if macOS handed it over and something played
    let systemAudio = false
    if (settings.systemAudio) {
      if (!info.hasSystemAudio || !(await this.sides.systemAudio.recorded())) warnings.push(t('warn.systemAudioUnavailable'))
      else {
        this.progress({ step: t('step.checkSystemAudio'), progress: -1 })
        const peak = await maxVolume(this.sides.systemAudio.path)
        if (peak === null || peak <= SILENCE_DB) warnings.push(t('warn.systemAudioSilent'))
        else systemAudio = true
      }
    }

    let mediaPath = ''
    let videoPath = ''
    let frames: { file: string; tMs: number }[] | undefined
    let skipped = 0

    if (format === 'jpg') {
      this.progress({ step: t('step.frames'), progress: 0 })
      const res = await extractFrames({
        input: this.rawPath,
        recordingDir: this.dir,
        fps: settings.jpgFps,
        filters,
        durationMs,
        skipUnchanged: settings.skipUnchangedFrames,
        geometry: g,
        samples: tracking.samples,
        t0: info.t0,
        onProgress: (p) => this.progress({ step: t('step.frames'), progress: p })
      })
      frames = res.frames
      skipped = res.skipped
      mediaPath = videoPath = join(this.dir, 'frames')
      if (info.hasAudio || systemAudio) {
        this.progress({ step: t('step.saveAudio'), progress: -1 })
        const audio = this.audioPlan(systemAudio, 1, durationMs)
        const args = ['-i', this.rawPath, ...audio.inputs, ...(audio.filter ? ['-filter_complex', audio.filter, '-map', audio.map] : ['-vn'])]
        await runFfmpeg([...args, '-c:a', 'aac', '-b:a', '128k', join(this.dir, 'audio.m4a')])
      }
    } else {
      videoPath = join(this.dir, `recording.${format}`)
      mediaPath = videoPath
      if (graph) {
        // People watch the video with the webcam; the timeline and the AI refer to the copy without it, if wanted
        if (settings.webcamCleanCopy) {
          mediaPath = join(this.dir, `recording-screen.${format}`)
          await this.convert(mediaPath, filters, format, g, durationMs, systemAudio)
        }
        await this.composeWebcam(graph, videoPath, format, g, durationMs, systemAudio)
      } else {
        await this.convert(videoPath, filters, format, g, durationMs, systemAudio)
      }
    }

    let segments: TranscriptSegment[] | null = null
    let words: TranscriptWord[] = []
    if (settings.audio && info.hasAudio && settings.transcribe) {
      if (!isModelInstalled(settings.whisperModel)) {
        warnings.push(t('warn.modelMissing', { model: settings.whisperModel }))
      } else {
        try {
          this.progress({ step: t('step.extractAudio'), progress: -1 })
          const audioPath = join(this.dir, 'audio.f32')
          await runFfmpeg(['-i', this.rawPath, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-acodec', 'pcm_f32le', audioPath])
          const transcribeStep = t('step.transcribe', { model: settings.whisperModel })
          this.progress({ step: transcribeStep, progress: -1, canSkipTranscription: true })
          this.transcribing = true
          const transcript = await transcribe(audioPath, settings.whisperModel, settings.speechLanguage, (p) =>
            this.progress({ step: transcribeStep, progress: p > 0 ? p : -1, canSkipTranscription: true })
          ).finally(() => {
            this.transcribing = false
            void rm(audioPath, { force: true })
          })
          // Like cursor samples and clicks, speech is limited to the recording's time span
          // (Whisper can hallucinate text timestamped past the end of the audio).
          segments = clipToDuration(transcript.segments, durationMs)
          words = clipToDuration(transcript.words, durationMs)
        } catch (e) {
          // killWorker() rejects with "cancelled": that is the user skipping it, not a failure
          if ((e as Error).message === 'cancelled') warnings.push(t('warn.transcriptionSkipped'))
          else {
            console.error('transcription failed', e)
            warnings.push(t('warn.transcriptionFailed', { error: (e as Error).message }))
          }
        }
      }
    }

    this.progress({ step: t('step.timeline'), progress: -1 })
    const txtPath = join(this.dir, 'recording.txt')
    const rawTxtPath = join(this.dir, 'recording-raw.txt')
    const jsonPath = join(this.dir, 'recording.json')
    const promptPath = join(this.dir, 'PROMPT.md')
    const timelineInput = {
      createdAt: this.startedAtDate,
      format,
      mediaName: format === 'jpg' ? 'frames/' : basename(mediaPath),
      webcam: placed ? { video: basename(videoPath), cleanCopy: mediaPath !== videoPath, layout: placed } : undefined,
      width: g.outWidth,
      height: g.outHeight,
      fps: format === 'jpg' ? settings.jpgFps : FRAME_RATE,
      durationMs,
      audio: settings.audio && info.hasAudio,
      systemAudio,
      whisperModel: settings.whisperModel,
      language: settings.speechLanguage,
      t0: info.t0,
      samples: tracking.samples,
      clicks: tracking.clicks,
      segments,
      words,
      cursorHz: settings.cursorHz,
      geometry: g,
      frames,
      skippedFrames: skipped,
      warnings
    }
    const texts = recordingTexts(timelineInput, this.dir, tracking.clicksTracked)
    await writeFile(txtPath, texts.txt, 'utf8')
    await writeFile(rawTxtPath, texts.rawTxt, 'utf8')
    await writeFile(promptPath, texts.prompt, 'utf8')

    const json: RecordingJson = {
      version: 1,
      app: 'traccia',
      createdAt: this.startedAtDate.toISOString(),
      format,
      media: timelineInput.mediaName,
      timeline: 'recording.txt',
      rawTimeline: 'recording-raw.txt',
      prompt: 'PROMPT.md',
      width: g.outWidth,
      height: g.outHeight,
      fps: format === 'jpg' ? settings.jpgFps : FRAME_RATE,
      durationMs,
      display: { id: this.display!.id, bounds: this.display!.bounds, scaleFactor: this.display!.scaleFactor },
      capture: { width: info.width, height: info.height, mimeType: info.mimeType },
      region: this.region,
      cropPx: g.cropPx,
      audio: settings.audio && info.hasAudio,
      systemAudio,
      whisper: segments ? { model: settings.whisperModel, language: settings.speechLanguage } : null,
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
          return { t: c.t - info.t0, button: c.button, x: p.x, y: p.y, speech: wordsAround(words, (c.t - info.t0) / 1000) }
        }),
      transcript: segments,
      words,
      frames,
      skippedFrames: skipped,
      webcam: placed ? { video: basename(videoPath), layout: placed } : undefined,
      cursorHz: settings.cursorHz,
      clicksTracked: tracking.clicksTracked,
      warnings
    }
    await writeFile(jsonPath, JSON.stringify(json), 'utf8')
    await rm(this.rawPath, { force: true })
    for (const side of Object.values(this.sides)) await side.remove()

    return {
      dir: this.dir,
      mediaPath,
      videoPath,
      txtPath,
      rawTxtPath,
      jsonPath,
      promptPath,
      durationMs,
      format,
      width: g.outWidth,
      height: g.outHeight,
      frames: frames?.length,
      skippedFrames: skipped,
      transcriptSegments: segments?.length,
      warnings
    }
  }
}

