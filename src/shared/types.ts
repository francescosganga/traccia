// Types shared between main, preload and renderer.
import type { UiLanguage } from './i18n'

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
  Pick<Settings, 'format' | 'resolution' | 'jpgFps' | 'skipUnchangedFrames' | 'audio' | 'transcribe' | 'countdown'>
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

export interface Permissions {
  screen: MediaAccessStatus
  microphone: MediaAccessStatus
  accessibility: boolean
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
  txtPath: string
  rawTxtPath: string
  /** Missing for recordings made before PROMPT.md existed */
  promptPath?: string
  jsonPath: string
  warnings: string[]
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
