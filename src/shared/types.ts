// Types shared between main, preload and renderer.
import type { UiLanguage } from './i18n'
import type { WebcamCorner, WebcamLayout, WebcamShape } from './webcam'

export type OutputFormat = 'mp4' | 'mov' | 'webm' | 'jpg'
export type Resolution = 'native' | '1080' | '720' | '480'
export type CaptureMode = 'screen' | 'region'
export type WhisperModelId = 'tiny' | 'base' | 'small' | 'large-v3-turbo'
export type SpeechLanguage = 'auto' | 'it' | 'en' | 'es' | 'fr' | 'de' | 'pt'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Settings {
  onboardingDone: boolean
  uiLanguage: UiLanguage
  outputDir: string
  format: OutputFormat
  resolution: Resolution
  /** Frames per second when format is "jpg" */
  jpgFps: number
  /** Drop frames that are visually identical to the previous kept frame (jpg mode) */
  skipUnchangedFrames: boolean
  /** Record the microphone */
  audio: boolean
  /** Microphone to record; null follows the system default */
  micDevice: InputDevice | null
  /** Record what the computer plays, mixed with the microphone in the video; not transcribed */
  systemAudio: boolean
  /** Record the webcam and lay it over a corner of the video (video formats only) */
  webcam: boolean
  /** Camera to record; null takes the first one */
  webcamDevice: InputDevice | null
  webcamShape: WebcamShape
  webcamCorner: WebcamCorner
  /** With the webcam, also save the video without it (recording-screen.<ext>): the timeline, PROMPT.md and agents refer to that one */
  webcamCleanCopy: boolean
  /** Run Whisper on the recorded audio */
  transcribe: boolean
  whisperModel: WhisperModelId
  /** Language spoken in the recording, passed to Whisper */
  speechLanguage: SpeechLanguage
  /** Log global mouse clicks (needs Accessibility permission on macOS) */
  trackClicks: boolean
  /** How many cursor samples per second are written to the timeline (video mode) */
  cursorHz: number
  /** Countdown in seconds before recording starts */
  countdown: number
  /** Show the floating "REC / Stop" widget while recording */
  showControls: boolean
  /** Outline the recorded region on screen while recording (excluded from the capture, like the widget) */
  showRegionFrame: boolean
  /** Global shortcuts (Electron accelerators) for a full-screen and a region recording; either one also stops the recording in progress */
  shortcutsEnabled: boolean
  shortcutScreen: string
  shortcutRegion: string
  /** Last used capture mode and display */
  lastMode: CaptureMode
  lastDisplayId: number | null
  /** Register the app as a login item (packaged app only) */
  openAtLogin: boolean
  /** When opened at login, keep the main window hidden and live in the menu bar */
  startHiddenAtLogin: boolean
  /** Show the app icon in the Dock (macOS). Off = menu-bar-only app */
  showInDock: boolean
}

/**
 * A microphone or a camera as the renderer lists it. Device ids are salted per origin
 * (the dev server and the packaged app see different ones), so the label finds it again.
 */
export interface InputDevice {
  id: string
  label: string
}

/** The inputs the main window sees, reported to the main process for the tray menu. */
export interface MicList {
  devices: InputDevice[]
  /** Label of the input the system uses by default, when known */
  defaultLabel: string | null
}

export interface LoginItemStatus {
  openAtLogin: boolean
  /** macOS 13+: 'requires-approval' means the user must allow it in System Settings → Login Items */
  status: 'not-registered' | 'enabled' | 'requires-approval' | 'not-found' | 'unknown'
  /** Login items can only be registered by the packaged app */
  packaged: boolean
}

export interface DisplayInfo {
  id: number
  label: string
  bounds: Rect
  scaleFactor: number
  primary: boolean
}

/** Settings a single recording may override without changing the saved ones (control socket). */
export type RecordingOverrides = Partial<
  Pick<Settings, 'format' | 'resolution' | 'jpgFps' | 'skipUnchangedFrames' | 'audio' | 'systemAudio' | 'webcam' | 'transcribe' | 'countdown'>
>

export interface RecordingRequest {
  mode: CaptureMode
  displayId?: number
  /** Region in DIP, relative to the display's top-left corner */
  region?: Rect
  overrides?: RecordingOverrides
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

export interface TranscriptSegment {
  /** Seconds from the start of the recording */
  start: number
  end: number
  text: string
}

export interface TranscriptWord {
  start: number
  end: number
  text: string
}

export interface TranscriptResult {
  /** Short phrases (split on punctuation, pauses and a maximum duration) */
  segments: TranscriptSegment[]
  /** Word-level timestamps, when the model provides them */
  words: TranscriptWord[]
}

export interface ProcessingProgress {
  step: string
  /** 0..1, or -1 when indeterminate */
  progress: number
  detail?: string
  /** Whisper is running and the user may skip it */
  canSkipTranscription?: boolean
}

/** What is being recorded, shown by the widget so a wrong choice is noticed before the end. */
export interface RecordingInfo {
  mode: CaptureMode
  format: OutputFormat
  jpgFps: number
  audio: boolean
  systemAudio: boolean
  /** The webcam's current layout, changed from the widget; null when the webcam is not recorded */
  webcam: WebcamLayout | null
}

export type AppState =
  | { status: 'idle' }
  | { status: 'selecting' }
  | { status: 'countdown'; seconds: number; info: RecordingInfo }
  | { status: 'recording'; startedAt: number; info: RecordingInfo }
  | ({ status: 'processing' } & ProcessingProgress)
  | { status: 'done'; result: RecordingResult }
  | { status: 'error'; message: string }

export interface RecordingResult {
  dir: string
  /** What the AI reads: the frames folder, the video, or the video without the webcam */
  mediaPath: string
  /** The video to watch: with the webcam when there is one; equals mediaPath otherwise */
  videoPath: string
  txtPath: string
  /** Same timeline plus pointer movement */
  rawTxtPath: string
  jsonPath: string
  /** PROMPT.md: instructions for an AI on how to read the folder */
  promptPath: string
  durationMs: number
  format: OutputFormat
  width: number
  height: number
  frames?: number
  skippedFrames?: number
  transcriptSegments?: number
  warnings: string[]
  /** The result of trimming a past recording, not of a new one */
  trimmed?: boolean
}

/** What the trim view plays, with absolute paths. */
export interface RecordingMedia {
  format: OutputFormat
  durationMs: number
  width: number
  height: number
  fps: number
  /** The video people watch (with the webcam, if there is one); null in JPG mode */
  video: string | null
  /** audio.m4a of a JPG recording, when there is one */
  audio: string | null
  /** JPG frames, oldest first; empty for a video */
  frames: { path: string; tMs: number }[]
  /** Trimmed before: original/ already holds the very first version */
  trimmed: boolean
}

export interface WhisperModelInfo {
  id: WhisperModelId
  label: string
  /** Approximate download size */
  sizeLabel: string
  description: string
  installed: boolean
  sizeOnDisk: number
  /** Snapshot folder in the Hugging Face cache that can be imported instead of downloading */
  cachedPath?: string
}

export interface DownloadProgress {
  model: WhisperModelId
  status: 'progress' | 'done' | 'error' | 'cancelled'
  /** 0..1 across all files of the model */
  progress: number
  file?: string
  error?: string
}

export type MediaAccessStatus = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'

export type PermissionKind = 'screen' | 'microphone' | 'camera' | 'accessibility'

export interface Permissions {
  screen: MediaAccessStatus
  microphone: MediaAccessStatus
  camera: MediaAccessStatus
  accessibility: boolean
  /** Screen Recording or Accessibility was granted after the app started: macOS applies it at the next launch */
  restartNeeded: boolean
}

/** Clients the settings page can register the MCP server with (see main/agents.ts). */
export type AgentTarget = 'claude-code' | 'claude-desktop' | 'cursor' | 'codex'

export interface AgentTargetStatus {
  id: AgentTarget
  /** The client is installed (its config folder, or the "claude" command, exists) */
  available: boolean
  /** Config file, or the claude command, that would be written */
  path: string | null
  /** An entry for this app exists; "stale" when it points to another copy of the app */
  configured: 'no' | 'yes' | 'stale'
}

/** How a client must launch the MCP server: the app's own binary as Node, running the bundled CLI. */
export interface McpServerSpec {
  command: string
  args: string[]
  env: Record<string, string>
}

export interface McpCommands {
  /** The launch line itself, as a shell command */
  launch: string
  /** `claude mcp add ...` to paste in a terminal */
  claude: string
  /** The mcpServers snippet for claude_desktop_config.json, Cursor and most clients */
  json: string
}

export interface AgentInstallResult {
  ok: boolean
  /** File written, or the claude command run */
  path: string
  /** Original error, already logged; the UI shows a translated line with it */
  error?: string
}

/** A past recording as listed from the output folder (see shared/recording-reader.ts). */
export interface RecordingEntry {
  /** Folder name inside the output directory, e.g. 2026-09-18_08-51-52 */
  id: string
  dir: string
  /** Name given by the user, kept in recording.json; the folder name never changes */
  title?: string
  createdAt: number
  format: OutputFormat
  durationMs: number
  width: number
  height: number
  /** Number of JPG frames (jpg format only) */
  frames?: number
  /** Number of transcript segments, undefined when there is no transcript */
  transcriptSegments?: number
  mediaPath: string
  /** The video to watch: with the webcam when there is one; equals mediaPath otherwise */
  videoPath: string
  txtPath: string
  rawTxtPath: string
  /** Missing for recordings made before PROMPT.md existed */
  promptPath?: string
  jsonPath: string
  warnings: string[]
}

/** Tracks the engine records beside the screen, each with its own MediaRecorder and file */
export type SideTrackKind = 'webcam' | 'systemAudio'

/** Sent from main to the recorder engine living in the main window's renderer */
export interface EngineStartCommand {
  audio: boolean
  micDevice: InputDevice | null
  systemAudio: boolean
  webcam: boolean
  webcamDevice: InputDevice | null
  frameRate: number
}

export interface EngineStartedInfo {
  /** Epoch ms of MediaRecorder "start" */
  t0: number
  width: number
  height: number
  mimeType: string
  hasAudio: boolean
  /** The chosen microphone was not connected and the system default was recorded */
  micFallback: boolean
  /** The webcam is being recorded too; its own start time arrives with engine:sideStarted */
  hasWebcam: boolean
  /** macOS handed over the system audio, recorded as a side track */
  hasSystemAudio: boolean
}
