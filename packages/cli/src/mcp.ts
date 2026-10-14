import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult, GetPromptResult, PromptMessage } from '@modelcontextprotocol/sdk/types.js'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import {
  APP_NAME,
  listRecordings,
  readRecording,
  readTimeline,
  timelineFileName,
  transcriptText,
  type RecordingJson
} from '../../../src/shared/recording-reader'
import { formatTime } from '../../../src/shared/time'
import type { AppState, RecordingEntry, RecordingRequest } from '../../../src/shared/types'
import { ControlClient, NotRunningError } from './client'
import { MAX_WIDTH, renderFrames } from './frames'

export interface McpOptions {
  version: string
  /** Output directory, resolved at every call so that a change in the app is picked up */
  outputDir: () => Promise<string>
  socketPath: string
}

/** Frames per get_frames call by default and at most: each 1024px image costs roughly 1,000 tokens. */
const DEFAULT_FRAMES = 10
const MAX_FRAMES = 30
const PROMPT_FRAMES = 8

const ID_DESCRIPTION = 'Recording id: the folder name (e.g. 2026-09-18_08-51-52), "latest", or the path of a recording folder'

function text(s: string): CallToolResult {
  return { content: [{ type: 'text', text: s }] }
}

function failure(e: unknown): CallToolResult {
  return { content: [{ type: 'text', text: (e as Error).message }], isError: true }
}

function summary(r: RecordingEntry): Record<string, unknown> {
  return {
    id: r.id,
    createdAt: new Date(r.createdAt).toISOString(),
    duration: formatTime(r.durationMs),
    durationMs: r.durationMs,
    format: r.format,
    size: `${r.width}x${r.height}`,
    frames: r.frames,
    transcriptSegments: r.transcriptSegments,
    warnings: r.warnings.length ? r.warnings : undefined,
    dir: r.dir
  }
}

function describeState(state: AppState): string {
  switch (state.status) {
    case 'recording':
      return `recording since ${new Date(state.startedAt).toISOString()} (${formatTime(Date.now() - state.startedAt)} so far)`
    case 'processing':
      return `processing: ${state.step}${state.progress >= 0 ? ` ${Math.round(state.progress * 100)}%` : ''}`
    case 'done':
      return `done: ${state.result.dir}`
    case 'error':
      return `error: ${state.message}`
    default:
      return state.status
  }
}

async function withApp<T>(socketPath: string, launch: boolean, fn: (client: ControlClient) => Promise<T>): Promise<T> {
  const client = await ControlClient.connectOrLaunch(socketPath, launch)
  try {
    return await fn(client)
  } finally {
    client.close()
  }
}

/** Timeline, transcript and a handful of frames of one recording, as prompt messages. */
async function recordingMessages(outputDir: string, id: string): Promise<{ messages: PromptMessage[]; meta: RecordingJson; entry: RecordingEntry }> {
  const { entry, meta } = await readRecording(outputDir, id)
  const timeline = await readTimeline(entry.dir, 'clicks')
  const messages: PromptMessage[] = [
    {
      role: 'user',
      content: {
        type: 'text',
        text:
          `Recording "${entry.id}" made with ${APP_NAME} (${formatTime(meta.durationMs)}, ${meta.format === 'm4a' ? '' : `${meta.width}x${meta.height}, `}` +
          `${meta.format === 'jpg' ? `${meta.frames?.length ?? 0} JPG frames` : `${meta.format} ${meta.format === 'm4a' ? 'audio' : 'video'}`}` +
          `${meta.transcript ? ', voice transcribed' : meta.audio ? ', audio without transcript' : ', no audio'}).\n\n` +
          `Timeline (${timelineFileName('clicks')}): timestamped transcript when enabled, with source and speaker labels when available. ` +
          `${meta.format === 'm4a' ? 'Audio only: no frames or clicks. ' : 'Screen recordings also include captured clicks with image coordinates and speech at each click. '}` +
          `${meta.format === 'jpg' ? 'JPG frame capture times are included. ' : ''}\n\n${timeline}`
      }
    }
  ]
  try {
    const frames = await renderFrames(entry.dir, meta, { max: PROMPT_FRAMES, maxWidth: MAX_WIDTH })
    if (frames.length) {
      messages.push({
        role: 'user',
        content: { type: 'text', text: `${frames.length} frames follow, in chronological order: ${frames.map((f) => formatTime(f.tMs)).join(', ')}.` }
      })
      for (const f of frames) {
        messages.push({ role: 'user', content: { type: 'image', data: f.jpeg.toString('base64'), mimeType: 'image/jpeg' } })
      }
    }
  } catch (e) {
    messages.push({ role: 'user', content: { type: 'text', text: `(No frames attached: ${(e as Error).message})` } })
  }
  return { messages, meta, entry }
}

export async function runMcpServer(opts: McpOptions): Promise<void> {
  const server = new McpServer({ name: 'traccia', version: opts.version })
  const dir = opts.outputDir

  // ---- reading recordings (works without the app running) ---------------------------

  server.registerTool(
    'list_recordings',
    {
      title: 'List recordings',
      description: `Lists screen and conversation recordings made with ${APP_NAME}, including audio-only recordings, newest first, with their id, date, duration, format and output folder. Dictation has no recording history.`,
      inputSchema: { limit: z.number().int().min(1).max(200).default(20).describe('How many recordings to return') },
      annotations: { readOnlyHint: true }
    },
    async ({ limit }) => {
      try {
        const list = await listRecordings(await dir(), limit)
        if (!list.length) return text(`No recordings found in ${await dir()}`)
        return text(JSON.stringify(list.map(summary), null, 2))
      } catch (e) {
        return failure(e)
      }
    }
  )

  server.registerTool(
    'get_timeline',
    {
      title: 'Get timeline',
      description:
        'Returns a screen or conversation recording timeline, including the timestamped transcript when enabled, audio-source labels, ' +
        'and speaker labels or manually assigned names when available. Screen recordings also include captured clicks with image coordinates ' +
        'and speech at each click; JPG recordings include frame capture times. The "raw" variant adds pointer movement for screen recordings. Audio-only recordings have no clicks or frames.',
      inputSchema: {
        id: z.string().describe(ID_DESCRIPTION),
        variant: z.enum(['clicks', 'raw']).default('clicks').describe('"clicks" (recording.txt) or "raw" (recording-raw.txt, with pointer movement)')
      },
      annotations: { readOnlyHint: true }
    },
    async ({ id, variant }) => {
      try {
        const { entry } = await readRecording(await dir(), id)
        return text(await readTimeline(entry.dir, variant))
      } catch (e) {
        return failure(e)
      }
    }
  )

  server.registerTool(
    'get_transcript',
    {
      title: 'Get transcript',
      description: 'Returns the saved transcript of a screen or conversation recording as timestamped text (Whisper, run locally by the app), including audio-source labels and speaker labels or manually assigned names when available. Speaker labels distinguish voices within each source, not verified identities. Does not transcribe new audio or retrieve dictation text.',
      inputSchema: { id: z.string().describe(ID_DESCRIPTION) },
      annotations: { readOnlyHint: true }
    },
    async ({ id }) => {
      try {
        const { meta } = await readRecording(await dir(), id)
        const t = transcriptText(meta)
        if (!t) return text(meta.audio ? 'This recording has audio but no transcript.' : 'This recording has no audio.')
        return text(t)
      } catch (e) {
        return failure(e)
      }
    }
  )

  server.registerTool(
    'get_frames',
    {
      title: 'Get frames',
      description:
        `Returns frames of a recording as JPEG images (downscaled to ${MAX_WIDTH}px wide), spread evenly between "from" and "to". ` +
        'JPG recordings return their stored frames; video recordings need ffmpeg to extract stills. Audio-only recordings return no frames. ' +
        `Each image costs roughly 1,000 tokens: ask for a narrow time range rather than many frames (default ${DEFAULT_FRAMES}, at most ${MAX_FRAMES}).`,
      inputSchema: {
        id: z.string().describe(ID_DESCRIPTION),
        from: z.number().min(0).optional().describe('Start of the time range, in ms from the beginning of the recording'),
        to: z.number().min(0).optional().describe('End of the time range, in ms'),
        max: z.number().int().min(1).max(MAX_FRAMES).default(DEFAULT_FRAMES).describe('Maximum number of frames to return')
      },
      annotations: { readOnlyHint: true }
    },
    async ({ id, from, to, max }) => {
      try {
        const { entry, meta } = await readRecording(await dir(), id)
        const frames = await renderFrames(entry.dir, meta, { from, to, max })
        if (!frames.length) return text('No frames in that time range.')
        const content: CallToolResult['content'] = [
          { type: 'text', text: `${frames.length} frames of ${entry.id} (${meta.width}x${meta.height}, downscaled to at most ${MAX_WIDTH}px wide):` }
        ]
        for (const f of frames) {
          content.push({ type: 'text', text: `${formatTime(f.tMs)} ${f.label}` })
          content.push({ type: 'image', data: f.jpeg.toString('base64'), mimeType: 'image/jpeg' })
        }
        return { content }
      } catch (e) {
        return failure(e)
      }
    }
  )

  // ---- controlling the app --------------------------------------------------------------

  server.registerTool(
    'get_status',
    {
      title: 'Get status',
      description: `Whether ${APP_NAME} is running and the state of its recording session (idle, selecting a region, countdown, recording, processing, done, error). Does not report the separate dictation session.`,
      annotations: { readOnlyHint: true }
    },
    async () => {
      try {
        const state = await withApp(opts.socketPath, false, (c) => c.request({ cmd: 'status' }))
        return text(JSON.stringify({ running: true, status: state.status, description: describeState(state), state }, null, 2))
      } catch (e) {
        if (e instanceof NotRunningError) return text(JSON.stringify({ running: false, description: e.message }, null, 2))
        return failure(e)
      }
    }
  )

  server.registerTool(
    'start_recording',
    {
      title: 'Start recording',
      description:
        `Starts a screen or audio-only conversation recording in ${APP_NAME} (the app must be running; on macOS "launch" opens it). ` +
        'Use format "m4a" for audio only. Microphone-only audio capture does not require Screen Recording permission; system audio does. Does not start dictation. ' +
        'Returns once the recording is rolling. Region mode without a region opens the on-screen selector and waits for the user to drag it. ' +
        'Options not given use the settings saved in the app; the ones given apply to this recording only.',
      inputSchema: {
        mode: z.enum(['screen', 'region']).default('screen').describe('Full screen, or a region of it'),
        displayId: z.number().int().optional().describe('Display to record (see get_status for the current one); defaults to the primary display'),
        region: z
          .object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() })
          .optional()
          .describe('Region in points relative to the top-left corner of the display; omit it to let the user select one on screen'),
        format: z.enum(['mp4', 'mov', 'webm', 'jpg', 'm4a']).optional().describe('Output format; "m4a" records audio only; "jpg" writes frames'),
        resolution: z.enum(['native', '1080', '720', '480']).optional(),
        jpgFps: z.number().positive().optional().describe('Frames per second in jpg mode'),
        audio: z.boolean().optional().describe('Record the microphone'),
        systemAudio: z.boolean().optional().describe('Record system audio'),
        conversation: z.boolean().optional().describe('Include microphone and system audio in local transcription when captured and transcription is enabled'),
        multiSpeaker: z.boolean().optional().describe('Label voices within each source when transcription is enabled; requires downloaded speaker models. Names are assigned manually in the app'),
        transcribe: z.boolean().optional().describe('Transcribe the audio with Whisper when the recording ends'),
        countdown: z.number().int().min(0).max(60).optional().describe('Seconds of countdown before recording starts'),
        launch: z.boolean().default(false).describe('Open the app if it is not running (macOS only)')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ mode, displayId, region, format, resolution, jpgFps, audio, systemAudio, conversation, multiSpeaker, transcribe, countdown, launch }) => {
      try {
        const overrides: RecordingRequest['overrides'] = {}
        if (format !== undefined) overrides.format = format
        if (resolution !== undefined) overrides.resolution = resolution
        if (jpgFps !== undefined) overrides.jpgFps = jpgFps
        if (systemAudio !== undefined) overrides.systemAudio = systemAudio
        if (conversation !== undefined) overrides.conversation = conversation
        if (multiSpeaker !== undefined) overrides.multiSpeaker = multiSpeaker
        if (audio !== undefined) overrides.audio = audio
        if (transcribe !== undefined) overrides.transcribe = transcribe
        if (countdown !== undefined) overrides.countdown = countdown
        const state = await withApp(opts.socketPath, launch, (c) => c.request({ cmd: 'start', mode, displayId, region, overrides }))
        if (state.status === 'error') return { content: [{ type: 'text', text: `Recording failed: ${state.message}` }], isError: true }
        if (state.status === 'idle') return text('Recording not started: the region selection was cancelled.')
        return text(JSON.stringify({ status: state.status, description: describeState(state), state }, null, 2))
      } catch (e) {
        return failure(e)
      }
    }
  )

  server.registerTool(
    'stop_recording',
    {
      title: 'Stop recording',
      description:
        'Stops the current screen or conversation recording, not dictation. By default waits for the output to be written (conversion and transcription can take a while) ' +
        'and returns the recording id and folder, ready for get_timeline and get_transcript, or get_frames when there is visual media.',
      inputSchema: { wait: z.boolean().default(true).describe('Wait for processing to finish') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ wait }) => {
      try {
        const state = await withApp(opts.socketPath, false, (c) => c.request({ cmd: 'stop', wait }))
        if (state.status === 'error') return { content: [{ type: 'text', text: `Recording failed: ${state.message}` }], isError: true }
        if (state.status === 'done') {
          const r = state.result
          const id = r.dir.split(/[\\/]/).pop()
          return text(
            JSON.stringify(
              { id, dir: r.dir, duration: formatTime(r.durationMs), format: r.format, size: `${r.width}x${r.height}`, frames: r.frames, transcriptSegments: r.transcriptSegments, warnings: r.warnings },
              null,
              2
            )
          )
        }
        return text(JSON.stringify({ status: state.status, description: describeState(state) }, null, 2))
      } catch (e) {
        return failure(e)
      }
    }
  )

  // ---- prompts ------------------------------------------------------------------------------

  server.registerPrompt(
    'write_bug_report',
    {
      title: 'Write a bug report',
      description: 'Provides a prompt and recorded evidence for the client AI to write a bug report with steps to reproduce. Best suited to screen recordings with clicks, transcript and frames; audio-only recordings provide no visual evidence.',
      argsSchema: { id: z.string().describe(ID_DESCRIPTION) }
    },
    async ({ id }): Promise<GetPromptResult> => {
      const { messages } = await recordingMessages(await dir(), id)
      messages.push({
        role: 'user',
        content: {
          type: 'text',
          text:
            'Write a bug report from this recording. Use what the user said as the description of the problem and the clicks and frames ' +
            'as the steps they took. Structure it as: Title; Environment (what you can tell from the screen: app, OS, browser); ' +
            'Steps to reproduce (numbered, one action each, with the UI element clicked when it can be identified); Expected result; ' +
            'Actual result; Notes (anything the user mentioned that does not fit above). Quote the user only where their words matter; ' +
            'do not invent details that are neither visible nor said.'
        }
      })
      return { description: `Bug report from recording ${id}`, messages }
    }
  )

  server.registerPrompt(
    'explain_recording',
    {
      title: 'Explain a recording',
      description: 'Provides a prompt for the client AI to explain a recording from its timeline, available transcript and frames. Audio-only conversations provide the transcript and timeline without frames. Traccia supplies the evidence; the client generates the explanation.',
      argsSchema: { id: z.string().describe(ID_DESCRIPTION) }
    },
    async ({ id }): Promise<GetPromptResult> => {
      const { messages } = await recordingMessages(await dir(), id)
      messages.push({
        role: 'user',
        content: {
          type: 'text',
          text:
            'Explain what happens in this recording: what the user is trying to do, the steps they take (in order, with timestamps), ' +
            'what they say while doing it, and where they seem to run into trouble or hesitate. Refer to the frames by their timestamp. ' +
            'Be concrete and stick to what is visible and said; end with a one-paragraph summary.'
        }
      })
      return { description: `Explanation of recording ${id}`, messages }
    }
  )

  // ---- resources ----------------------------------------------------------------------------

  const files: Record<string, string> = { 'recording.txt': 'text/plain', 'recording-raw.txt': 'text/plain', 'recording.json': 'application/json' }

  server.registerResource(
    'recording-files',
    new ResourceTemplate('recording://{id}/{file}', {
      list: async () => {
        const list = await listRecordings(await dir(), 50)
        return {
          resources: list.flatMap((r) =>
            Object.entries(files).map(([file, mimeType]) => ({
              uri: `recording://${r.id}/${file}`,
              name: `${r.id}/${file}`,
              mimeType,
              description: `${new Date(r.createdAt).toLocaleString()}, ${formatTime(r.durationMs)}, ${r.format}`
            }))
          )
        }
      },
      complete: { id: async (value) => (await listRecordings(await dir(), 50)).map((r) => r.id).filter((id) => id.startsWith(value)) }
    }),
    { title: 'Recording files', description: 'recording.txt, recording-raw.txt and recording.json of screen and conversation recordings, including audio-only recordings; no dictation history' },
    async (uri, { id, file }) => {
      const name = String(file)
      const mimeType = files[name]
      if (!mimeType) throw new Error(`unknown file "${name}": expected one of ${Object.keys(files).join(', ')}`)
      const { entry } = await readRecording(await dir(), String(id))
      return { contents: [{ uri: uri.href, mimeType, text: await readFile(join(entry.dir, name), 'utf8') }] }
    }
  )

  server.registerResource(
    'recording-frame',
    new ResourceTemplate('recording://{id}/frames/{name}', { list: undefined }),
    { title: 'Recording frame', description: `A stored frame from a JPG recording, downscaled to ${MAX_WIDTH}px wide (e.g. recording://<id>/frames/frame_00003.jpg); not available for audio-only recordings`, mimeType: 'image/jpeg' },
    async (uri, { id, name }) => {
      const { entry, meta } = await readRecording(await dir(), String(id))
      const frame = (meta.frames ?? []).find((f) => f.file === `frames/${String(name)}`)
      if (!frame) throw new Error(`no frame "${String(name)}" in recording ${entry.id}`)
      const [rendered] = await renderFrames(entry.dir, meta, { from: frame.tMs, to: frame.tMs, max: 1 })
      return { contents: [{ uri: uri.href, mimeType: 'image/jpeg', blob: rendered.jpeg.toString('base64') }] }
    }
  )

  await server.connect(new StdioServerTransport())
}
