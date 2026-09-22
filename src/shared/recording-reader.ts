/**
 * Reads recordings and the app's settings straight from disk. Shared by the main process
 * and by the CLI / MCP server in packages/cli, so it depends on Node built-ins only: no
 * Electron, no native modules.
 */
import { existsSync } from 'fs'
import { readFile, readdir, stat } from 'fs/promises'
import { createHash } from 'crypto'
import { homedir, tmpdir } from 'os'
import { basename, isAbsolute, join, resolve } from 'path'
import { SHORTCUT_PRESETS } from './shortcuts'
import type { OutputFormat, RecordingEntry, Rect, Settings, TranscriptSegment, TranscriptWord } from './types'

export const APP_NAME = 'Traccia'
// Electron names the userData folder after package.json's "name", not the product name.
const USER_DATA_NAME = 'traccia'

// ---- paths -----------------------------------------------------------------------

/**
 * Electron's userData folder for this app (settings.json, control socket, ...).
 * TRACCIA_USER_DATA overrides it, in the app as well as here.
 */
export function appDataDir(): string {
  if (process.env.TRACCIA_USER_DATA) return process.env.TRACCIA_USER_DATA
  const home = homedir()
  switch (process.platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', USER_DATA_NAME)
    case 'win32':
      return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), USER_DATA_NAME)
    default:
      return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), USER_DATA_NAME)
  }
}

export function settingsPath(userData = appDataDir()): string {
  return join(userData, 'settings.json')
}

// sun_path is 104 bytes on macOS (108 on Linux), including the terminator.
const MAX_SOCKET_PATH = 100

/**
 * Where the running app listens for control commands: control.sock in the userData folder,
 * or a per-user temp path when that one is too long for a Unix socket. A named pipe on
 * Windows (untested: the app itself is macOS-only for now). TRACCIA_CONTROL_SOCKET overrides it.
 */
export function controlSocketPath(userData = appDataDir()): string {
  if (process.env.TRACCIA_CONTROL_SOCKET) return process.env.TRACCIA_CONTROL_SOCKET
  if (process.platform === 'win32') return '\\\\.\\pipe\\traccia-control'
  const path = join(userData, 'control.sock')
  if (Buffer.byteLength(path) <= MAX_SOCKET_PATH) return path
  return join(tmpdir(), `traccia-${createHash('sha1').update(userData).digest('hex').slice(0, 8)}.sock`)
}

export function defaultOutputDir(): string {
  return join(homedir(), process.platform === 'darwin' ? 'Movies' : 'Videos', APP_NAME)
}

/** Settings defaults that do not depend on Electron (the app adds outputDir). */
export const SETTINGS_DEFAULTS: Omit<Settings, 'outputDir'> = {
  onboardingDone: false,
  uiLanguage: 'en',
  format: 'mp4',
  resolution: 'native',
  jpgFps: 2,
  skipUnchangedFrames: true,
  audio: true,
  transcribe: true,
  whisperModel: 'base',
  speechLanguage: 'auto',
  trackClicks: true,
  cursorHz: 10,
  countdown: 3,
  showControls: true,
  // Off until the user picks the keys: the macOS ones fire the system screenshot until disabled in System Settings
  shortcutsEnabled: false,
  shortcutScreen: SHORTCUT_PRESETS.mac.screen,
  shortcutRegion: SHORTCUT_PRESETS.mac.region,
  lastMode: 'screen',
  lastDisplayId: null,
  openAtLogin: false,
  startHiddenAtLogin: true,
  showInDock: true
}

/** Settings as the app would see them: the file merged over the defaults, or the defaults alone. */
export async function readSettingsFile(path = settingsPath()): Promise<Settings> {
  const defaults: Settings = { ...SETTINGS_DEFAULTS, outputDir: defaultOutputDir() }
  if (!existsSync(path)) return defaults
  const stored = JSON.parse(await readFile(path, 'utf8')) as Partial<Settings>
  return { ...defaults, ...stored }
}

// ---- recording.json ---------------------------------------------------------------

export interface FrameRef {
  /** Path relative to the recording folder, e.g. frames/frame_00001.jpg */
  file: string
  /** ms from the start of the recording */
  tMs: number
}

export interface RecordingClick {
  t: number
  button: 'left' | 'right' | 'middle'
  x: number
  y: number
  /** Words being spoken around the click, empty when silent */
  speech: string
}

/** Contents of recording.json, as written by the session at the end of a recording. */
export interface RecordingJson {
  version: number
  app: string
  createdAt: string
  format: OutputFormat
  /** Media file name, or "frames/" in JPG mode */
  media: string
  timeline: string
  rawTimeline: string
  /** PROMPT.md, missing in recordings made before it existed */
  prompt?: string
  width: number
  height: number
  fps: number
  durationMs: number
  display: { id: number; bounds: Rect; scaleFactor: number }
  capture: { width: number; height: number; mimeType: string }
  region: Rect | null
  cropPx: Rect
  audio: boolean
  whisper: { model: string; language: string } | null
  /** [ms, x, y] in output pixels, full sample rate */
  cursor: [number, number, number][]
  clicks: RecordingClick[]
  transcript: TranscriptSegment[] | null
  words: TranscriptWord[]
  frames?: FrameRef[]
  skippedFrames?: number
  warnings: string[]
}

export type TimelineVariant = 'clicks' | 'raw'

export function timelineFileName(variant: TimelineVariant): string {
  return variant === 'raw' ? 'recording-raw.txt' : 'recording.txt'
}

export async function readRecordingJson(dir: string): Promise<RecordingJson> {
  return JSON.parse(await readFile(join(dir, 'recording.json'), 'utf8')) as RecordingJson
}

function toEntry(dir: string, id: string, meta: RecordingJson, fallbackCreatedAt: number): RecordingEntry {
  return {
    id,
    dir,
    createdAt: meta.createdAt ? Date.parse(meta.createdAt) : fallbackCreatedAt,
    format: meta.format,
    durationMs: meta.durationMs ?? 0,
    width: meta.width,
    height: meta.height,
    frames: meta.frames?.length,
    transcriptSegments: meta.transcript?.length,
    mediaPath: join(dir, meta.media ?? ''),
    txtPath: join(dir, timelineFileName('clicks')),
    rawTxtPath: join(dir, timelineFileName('raw')),
    jsonPath: join(dir, 'recording.json'),
    promptPath: existsSync(join(dir, 'PROMPT.md')) ? join(dir, 'PROMPT.md') : undefined,
    warnings: meta.warnings ?? []
  }
}

/** Lists past recordings (folders containing recording.json), newest first. */
export async function listRecordings(outputDir: string, limit = 20): Promise<RecordingEntry[]> {
  if (!existsSync(outputDir)) return []
  const entries: RecordingEntry[] = []
  for (const name of await readdir(outputDir)) {
    const dir = join(outputDir, name)
    const jsonPath = join(dir, 'recording.json')
    if (!existsSync(jsonPath)) continue
    try {
      const meta = await readRecordingJson(dir)
      const s = await stat(jsonPath)
      entries.push(toEntry(dir, name, meta, s.mtimeMs))
    } catch (e) {
      console.error('cannot read', jsonPath, e)
    }
  }
  return entries.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
}

/**
 * Turns a recording id into its folder. The id is the folder name inside outputDir
 * (2026-09-18_08-51-52), "latest" for the most recent one, or a path to a recording folder.
 */
export async function resolveRecordingDir(outputDir: string, id: string): Promise<string> {
  if (id === 'latest') {
    const [latest] = await listRecordings(outputDir, 1)
    if (!latest) throw new Error(`No recordings in ${outputDir}`)
    return latest.dir
  }
  const dir = isAbsolute(id) ? id : join(outputDir, id)
  if (!existsSync(join(dir, 'recording.json'))) throw new Error(`Recording not found: ${id} (looked in ${resolve(dir)})`)
  return dir
}

export async function readRecording(outputDir: string, id: string): Promise<{ entry: RecordingEntry; meta: RecordingJson }> {
  const dir = await resolveRecordingDir(outputDir, id)
  const meta = await readRecordingJson(dir)
  const s = await stat(join(dir, 'recording.json'))
  return { entry: toEntry(dir, basename(dir), meta, s.mtimeMs), meta }
}

export async function readTimeline(dir: string, variant: TimelineVariant): Promise<string> {
  return readFile(join(dir, timelineFileName(variant)), 'utf8')
}

export interface FrameFile extends FrameRef {
  /** Absolute path of the JPG */
  path: string
}

/** Frames of a JPG recording, oldest first. Empty for video recordings. */
export function listFrames(dir: string, meta: RecordingJson): FrameFile[] {
  return (meta.frames ?? []).map((f) => ({ ...f, path: join(dir, f.file) }))
}

/**
 * Picks at most `max` frames between `from` and `to` (ms), spread evenly over that span
 * so that a long recording still gives a representative sample.
 */
export function selectFrames<T extends FrameRef>(frames: T[], opts: { from?: number; to?: number; max: number }): T[] {
  const from = opts.from ?? 0
  const to = opts.to ?? Infinity
  const inRange = frames.filter((f) => f.tMs >= from && f.tMs <= to)
  const max = Math.max(1, Math.floor(opts.max))
  if (inRange.length <= max) return inRange
  const picked: T[] = []
  let last = -1
  for (let i = 0; i < max; i++) {
    const idx = Math.round((i * (inRange.length - 1)) / (max - 1))
    if (idx !== last) picked.push(inRange[idx])
    last = idx
  }
  return picked
}

/**
 * Evenly spaced instants (ms) to sample a video between `from` and `to`, at most one every
 * 500 ms and none in the last 100 ms, where a seek can land past the final frame.
 */
export function sampleTimes(durationMs: number, opts: { from?: number; to?: number; max: number }): number[] {
  const end = Math.max(0, durationMs - 100)
  const from = Math.min(end, Math.max(0, opts.from ?? 0))
  const to = Math.min(end, opts.to ?? end)
  if (to < from) return []
  const count = Math.max(1, Math.min(Math.floor(opts.max), Math.floor((to - from) / 500) + 1))
  if (count === 1) return [Math.round((from + to) / 2)]
  const times: number[] = []
  for (let i = 0; i < count; i++) times.push(Math.round(from + (i * (to - from)) / (count - 1)))
  return times
}

export function formatTime(ms: number): string {
  const total = Math.max(0, ms) / 1000
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mmss = `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`
  return h > 0 ? `${h}:${mmss}` : mmss
}

/** The transcript as timestamped lines, one segment per line. Empty string when there is none. */
export function transcriptText(meta: RecordingJson): string {
  if (!meta.transcript?.length) return ''
  return meta.transcript.map((s) => `[${formatTime(s.start * 1000)} → ${formatTime(s.end * 1000)}] ${s.text}`).join('\n') + '\n'
}
