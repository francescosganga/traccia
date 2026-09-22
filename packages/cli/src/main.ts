import { parseArgs } from 'util'
import {
  APP_NAME,
  controlSocketPath,
  formatTime,
  listRecordings,
  readRecording,
  readSettingsFile,
  readTimeline,
  settingsPath
} from '../../../src/shared/recording-reader'
import type { AppState, OutputFormat, RecordingOverrides, RecordingRequest, Resolution } from '../../../src/shared/types'
import { ControlClient, NotRunningError } from './client'
import { runMcpServer } from './mcp'

// Injected by build.mjs from package.json.
declare const __CLI_VERSION__: string
const VERSION = typeof __CLI_VERSION__ === 'string' ? __CLI_VERSION__ : 'dev'

const HELP = `traccia ${VERSION} — CLI and MCP server for ${APP_NAME}, the AI screen recorder

Usage:
  traccia list [--limit N] [--json]           recordings in the output folder, newest first
  traccia show <id> [--raw] [--json]          print a recording's timeline (recording.txt, or recording-raw.txt with --raw)
  traccia status [--json]                     what the running app is doing
  traccia record start [options] [--json]     start a recording (the app must be running, or pass --launch)
  traccia record stop [--no-wait] [--json]    stop the recording and wait for its files
  traccia displays [--json]                   displays the app can record
  traccia settings                            the app's settings, as JSON
  traccia mcp                                 run the MCP server on stdio (tools, prompts and resources for AI agents)

<id> is a folder name in the output directory (2026-09-18_08-51-52), "latest", or the path of a recording folder.

Record options:
  --region                select a region on screen by dragging, as from the app
  --rect x,y,w,h          region in points relative to the display, without the on-screen selection
  --display <id>          display to record (see \`traccia displays\`); default: the primary one
  --format <f>            mp4 | mov | webm | jpg          (default: the app's setting)
  --jpg                   same as --format jpg
  --fps <n>               frames per second in jpg mode
  --resolution <r>        native | 1080 | 720 | 480
  --no-audio              do not record the microphone
  --no-transcribe         skip the Whisper transcription
  --countdown <s>         seconds before the recording starts
  --launch                open the app when it is not running (macOS)

Global options:
  --dir <path>            output folder (default: the app's setting, TRACCIA_OUTPUT_DIR, or ~/Movies/${APP_NAME})
  --socket <path>         control socket (default: ${controlSocketPath()})
  --json                  machine-readable output
  -h, --help              this help
  -v, --version           print the version
`

class UsageError extends Error {}

const options = {
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'v', default: false },
  dir: { type: 'string' },
  socket: { type: 'string' },
  limit: { type: 'string' },
  raw: { type: 'boolean', default: false },
  region: { type: 'boolean', default: false },
  rect: { type: 'string' },
  display: { type: 'string' },
  format: { type: 'string' },
  jpg: { type: 'boolean', default: false },
  fps: { type: 'string' },
  resolution: { type: 'string' },
  'no-audio': { type: 'boolean', default: false },
  'no-transcribe': { type: 'boolean', default: false },
  countdown: { type: 'string' },
  launch: { type: 'boolean', default: false },
  'no-wait': { type: 'boolean', default: false }
} as const

type Flags = ReturnType<typeof parseArgs<{ options: typeof options; allowPositionals: true }>>['values']

function number(flags: Flags, name: 'limit' | 'display' | 'fps' | 'countdown', integer = true): number | undefined {
  const raw = flags[name]
  if (raw === undefined) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) throw new UsageError(`--${name} expects a${integer ? 'n integer' : ' number'}, got "${raw}"`)
  return n
}

function oneOf<T extends string>(flags: Flags, name: 'format' | 'resolution', allowed: readonly T[]): T | undefined {
  const raw = flags[name]
  if (raw === undefined) return undefined
  if (!(allowed as readonly string[]).includes(raw)) throw new UsageError(`--${name} must be one of ${allowed.join(', ')}`)
  return raw as T
}

async function outputDir(flags: Flags): Promise<string> {
  return flags.dir ?? process.env.TRACCIA_OUTPUT_DIR ?? (await readSettingsFile()).outputDir
}

function socketPath(flags: Flags): string {
  return flags.socket ?? controlSocketPath()
}

function describe(state: AppState): string {
  switch (state.status) {
    case 'idle':
      return 'idle'
    case 'selecting':
      return 'selecting a region on screen'
    case 'countdown':
      return state.seconds > 0 ? `starting in ${state.seconds}…` : 'starting…'
    case 'recording':
      return `recording (${formatTime(Date.now() - state.startedAt).slice(0, 5)})`
    case 'processing':
      return `${state.step}${state.progress >= 0 ? ` ${Math.round(state.progress * 100)}%` : ''}`
    case 'done':
      return `done: ${state.result.dir}`
    case 'error':
      return `error: ${state.message}`
  }
}

const progress = (state: AppState) => console.error(describe(state))

// ---- commands ---------------------------------------------------------------------------

async function list(flags: Flags): Promise<void> {
  const dir = await outputDir(flags)
  const recordings = await listRecordings(dir, number(flags, 'limit') ?? 20)
  if (flags.json) {
    console.log(JSON.stringify(recordings, null, 2))
    return
  }
  if (!recordings.length) {
    console.log(`No recordings in ${dir}`)
    return
  }
  for (const r of recordings) {
    const date = new Date(r.createdAt)
    const when = `${date.toISOString().slice(0, 10)} ${date.toTimeString().slice(0, 5)}`
    const extras = [
      r.frames !== undefined ? `${r.frames} frames` : null,
      r.transcriptSegments !== undefined ? `${r.transcriptSegments} transcript segments` : null,
      r.warnings.length ? `${r.warnings.length} warnings` : null
    ].filter(Boolean)
    console.log(
      `${r.id.padEnd(21)} ${when}  ${formatTime(r.durationMs).slice(0, 5)}  ${r.format.padEnd(4)}  ${`${r.width}x${r.height}`.padEnd(9)}  ${extras.join(', ')}`
    )
  }
}

async function show(flags: Flags, id: string | undefined): Promise<void> {
  if (!id) throw new UsageError('show needs a recording id')
  const { entry, meta } = await readRecording(await outputDir(flags), id)
  if (flags.json) {
    console.log(JSON.stringify({ ...entry, transcript: meta.transcript, clicks: meta.clicks }, null, 2))
    return
  }
  process.stdout.write(await readTimeline(entry.dir, flags.raw ? 'raw' : 'clicks'))
}

async function status(flags: Flags): Promise<void> {
  let client: ControlClient
  try {
    client = await ControlClient.connect(socketPath(flags))
  } catch (e) {
    if (!(e instanceof NotRunningError)) throw e
    if (flags.json) console.log(JSON.stringify({ running: false }))
    else console.log(e.message)
    process.exitCode = 1
    return
  }
  try {
    const state = await client.request({ cmd: 'status' })
    if (flags.json) console.log(JSON.stringify({ running: true, state }, null, 2))
    else console.log(`${APP_NAME}: ${describe(state)}`)
  } finally {
    client.close()
  }
}

function parseRect(raw: string): RecordingRequest['region'] {
  const parts = raw.split(',').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)) || parts[2] <= 0 || parts[3] <= 0) {
    throw new UsageError(`--rect expects x,y,width,height in points, got "${raw}"`)
  }
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] }
}

async function recordStart(flags: Flags): Promise<void> {
  const overrides: RecordingOverrides = {}
  const format = flags.jpg ? 'jpg' : oneOf<OutputFormat>(flags, 'format', ['mp4', 'mov', 'webm', 'jpg'])
  if (format) overrides.format = format
  const resolution = oneOf<Resolution>(flags, 'resolution', ['native', '1080', '720', '480'])
  if (resolution) overrides.resolution = resolution
  const fps = number(flags, 'fps', false)
  if (fps !== undefined) overrides.jpgFps = fps
  const countdown = number(flags, 'countdown')
  if (countdown !== undefined) overrides.countdown = countdown
  if (flags['no-audio']) overrides.audio = false
  if (flags['no-transcribe']) overrides.transcribe = false
  const region = flags.rect ? parseRect(flags.rect) : undefined
  const req: RecordingRequest = { mode: flags.region || region ? 'region' : 'screen', displayId: number(flags, 'display'), region, overrides }

  const client = await ControlClient.connectOrLaunch(socketPath(flags), flags.launch)
  try {
    const state = await client.request({ cmd: 'start', ...req }, flags.json ? undefined : progress)
    if (flags.json) console.log(JSON.stringify(state, null, 2))
    else console.log(describe(state))
    if (state.status !== 'recording') process.exitCode = 1
  } finally {
    client.close()
  }
}

async function recordStop(flags: Flags): Promise<void> {
  const client = await ControlClient.connect(socketPath(flags))
  try {
    const state = await client.request({ cmd: 'stop', wait: !flags['no-wait'] }, flags.json ? undefined : progress)
    if (flags.json) {
      console.log(JSON.stringify(state, null, 2))
    } else if (state.status === 'done') {
      const r = state.result
      console.log(`Saved to ${r.dir}`)
      console.log(`  ${r.format === 'jpg' ? `${r.frames} frames in frames/` : r.mediaPath.split(/[\\/]/).pop()}, ${formatTime(r.durationMs)}, ${r.width}x${r.height}`)
      console.log(`  recording.txt, recording-raw.txt, recording.json${r.transcriptSegments !== undefined ? ` (${r.transcriptSegments} transcript segments)` : ''}`)
      for (const w of r.warnings) console.log(`  warning: ${w}`)
    } else {
      console.log(describe(state))
    }
    if (state.status === 'error') process.exitCode = 1
  } finally {
    client.close()
  }
}

async function displays(flags: Flags): Promise<void> {
  const client = await ControlClient.connect(socketPath(flags))
  try {
    const list = await client.request({ cmd: 'displays' })
    if (flags.json) {
      console.log(JSON.stringify(list, null, 2))
      return
    }
    for (const d of list) {
      const b = d.bounds
      console.log(`${String(d.id).padEnd(12)} ${d.label.padEnd(24)} ${b.width}x${b.height} at ${b.x},${b.y} (@${d.scaleFactor}x)${d.primary ? '  primary' : ''}`)
    }
  } finally {
    client.close()
  }
}

async function settings(flags: Flags): Promise<void> {
  try {
    const client = await ControlClient.connect(socketPath(flags))
    try {
      console.log(JSON.stringify(await client.request({ cmd: 'settings' }), null, 2))
      return
    } finally {
      client.close()
    }
  } catch (e) {
    if (!(e instanceof NotRunningError)) throw e
  }
  // Without the app, the file on disk merged with the defaults is the next best thing.
  console.error(`${APP_NAME} is not running; reading ${settingsPath()}`)
  console.log(JSON.stringify(await readSettingsFile(), null, 2))
}

async function mcp(flags: Flags): Promise<void> {
  await runMcpServer({ version: VERSION, outputDir: () => outputDir(flags), socketPath: socketPath(flags) })
}

// ---- entry point -------------------------------------------------------------------------

async function main(argv: string[]): Promise<void> {
  const { values: flags, positionals } = parseArgs({ args: argv, options, allowPositionals: true, strict: true })
  if (flags.version) {
    console.log(VERSION)
    return
  }
  const [command, arg] = positionals
  if (flags.help || !command) {
    process.stdout.write(HELP)
    if (!command && !flags.help) process.exitCode = 2
    return
  }
  switch (command) {
    case 'list':
      return list(flags)
    case 'show':
      return show(flags, arg)
    case 'status':
      return status(flags)
    case 'record':
      if (arg === 'start') return recordStart(flags)
      if (arg === 'stop') return recordStop(flags)
      throw new UsageError('record needs "start" or "stop"')
    case 'displays':
      return displays(flags)
    case 'settings':
      return settings(flags)
    case 'mcp':
      return mcp(flags)
    default:
      throw new UsageError(`unknown command "${command}"`)
  }
}

main(process.argv.slice(2)).catch((e: Error) => {
  const usage = e instanceof UsageError || e.name === 'TypeError' && 'code' in e && String(e.code).startsWith('ERR_PARSE_ARGS')
  console.error(`traccia: ${e.message}`)
  if (usage) console.error('Run "traccia --help" for usage.')
  process.exitCode = usage ? 2 : 1
})
