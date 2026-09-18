// Types shared between main, preload and renderer.
import type { UiLanguage } from './i18n'

export type OutputFormat = 'mp4' | 'mov' | 'webm'
export type Resolution = 'native' | '1080' | '720' | '480'
export type CaptureMode = 'screen' | 'region'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Settings {
  uiLanguage: UiLanguage
  outputDir: string
  format: OutputFormat
  resolution: Resolution
  /** Record the microphone */
  audio: boolean
  /** Log global mouse clicks (needs Accessibility permission on macOS) */
  trackClicks: boolean
  /** How many cursor samples per second are written to the timeline (video mode) */
  cursorHz: number
  /** Countdown in seconds before recording starts */
  countdown: number
  /** Show the floating "REC / Stop" widget while recording */
  showControls: boolean
  /** Global shortcut that starts/stops a recording */
  shortcut: string
  /** Last used capture mode and display */
  lastMode: CaptureMode
  lastDisplayId: number | null
}

export interface DisplayInfo {
  id: number
  label: string
  bounds: Rect
  scaleFactor: number
  primary: boolean
}

export interface RecordingRequest {
  mode: CaptureMode
  displayId?: number
  /** Region in DIP, relative to the display's top-left corner */
  region?: Rect
}

export interface CursorSample {
  /** Epoch ms */
  t: number
  /** Global DIP coordinates */
  x: number
  y: number
}

export interface ClickEvent {
  t: number
  button: 'left' | 'right' | 'middle'
  x: number
  y: number
}

export interface ProcessingProgress {
  step: string
  /** 0..1, or -1 when indeterminate */
  progress: number
  detail?: string
}

export type AppState =
  | { status: 'idle' }
  | { status: 'selecting' }
  | { status: 'countdown'; seconds: number }
  | { status: 'recording'; startedAt: number }
  | ({ status: 'processing' } & ProcessingProgress)
  | { status: 'done'; result: RecordingResult }
  | { status: 'error'; message: string }

export interface RecordingResult {
  dir: string
  mediaPath: string
  txtPath: string
  /** Same timeline plus pointer movement */
  rawTxtPath: string
  jsonPath: string
  durationMs: number
  format: OutputFormat
  width: number
  height: number
  warnings: string[]
}

export type MediaAccessStatus = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'

export interface Permissions {
  screen: MediaAccessStatus
  microphone: MediaAccessStatus
  accessibility: boolean
}

export interface RecordingEntry {
  dir: string
  name: string
  createdAt: number
  format: OutputFormat
  durationMs: number
  mediaPath: string
  txtPath: string
  rawTxtPath: string
}

/** Sent from main to the recorder engine living in the main window's renderer */
export interface EngineStartCommand {
  audio: boolean
  frameRate: number
}

export interface EngineStartedInfo {
  /** Epoch ms of MediaRecorder "start" */
  t0: number
  width: number
  height: number
  mimeType: string
  hasAudio: boolean
}
