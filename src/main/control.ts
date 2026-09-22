import { app } from 'electron'
import { chmodSync, existsSync, unlinkSync } from 'fs'
import { createServer, type Server, type Socket } from 'net'
import type { ControlMessage, ControlRequest } from '../shared/control'
import { controlSocketPath } from '../shared/recording-reader'
import type { AppState, RecordingRequest } from '../shared/types'
import { listDisplays } from './ipc'
import type { RecordingSession } from './session'
import { getSettings } from './settings'

/**
 * Local control socket for the CLI and the MCP server (packages/cli): JSON lines over a
 * Unix domain socket in the userData folder, readable by the current user only. The
 * protocol is described in src/shared/control.ts.
 */
export interface ControlDeps {
  session: RecordingSession
  startRecording: (req: RecordingRequest) => Promise<void>
}

type Subscribe = (listener: (state: AppState) => void) => () => void

let server: Server | null = null
let socketPath = ''
// Two clients asking to start at the same time must not both get past the busy check.
let starting = false
const stateListeners = new Set<(state: AppState) => void>()

/** Call from the session's onState so pending start/stop requests can follow the recording. */
export function notifyControlState(state: AppState): void {
  for (const l of stateListeners) l(state)
}

export function startControlServer(deps: ControlDeps): void {
  socketPath = controlSocketPath(app.getPath('userData'))
  // The single-instance lock guarantees no other Traccia is listening, so a leftover
  // socket file can only be stale (crash, SIGKILL).
  if (process.platform !== 'win32' && existsSync(socketPath)) unlinkSync(socketPath)
  server = createServer((socket) => handleConnection(socket, deps))
  server.on('error', (e) => console.error('control socket error', e))
  server.listen(socketPath, () => {
    if (process.platform !== 'win32') chmodSync(socketPath, 0o600)
    console.log('control socket listening on', socketPath)
  })
}

export function stopControlServer(): void {
  server?.close()
  server = null
  if (process.platform !== 'win32' && socketPath && existsSync(socketPath)) {
    try {
      unlinkSync(socketPath)
    } catch (e) {
      console.error('cannot remove control socket', e)
    }
  }
}

function handleConnection(socket: Socket, deps: ControlDeps): void {
  let buffer = ''
  const listeners = new Set<(state: AppState) => void>()
  const send = (msg: ControlMessage) => {
    if (!socket.destroyed) socket.write(JSON.stringify(msg) + '\n')
  }
  // Listeners are dropped when the request completes, or when the client goes away.
  const subscribe: Subscribe = (l) => {
    listeners.add(l)
    stateListeners.add(l)
    return () => {
      listeners.delete(l)
      stateListeners.delete(l)
    }
  }
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    buffer += chunk
    let nl = buffer.indexOf('\n')
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) void dispatch(line, deps, send, subscribe)
      nl = buffer.indexOf('\n')
    }
  })
  socket.on('close', () => {
    for (const l of listeners) stateListeners.delete(l)
  })
  socket.on('error', (e) => console.error('control connection error', e))
}

async function dispatch(line: string, deps: ControlDeps, send: (msg: ControlMessage) => void, subscribe: Subscribe): Promise<void> {
  let req: ControlRequest
  try {
    req = JSON.parse(line)
  } catch {
    send({ ok: false, error: 'invalid JSON' })
    return
  }
  const id = req.id
  try {
    const result = await handle(req, deps, (state) => send({ id, event: 'state', state }), subscribe)
    send({ id, ok: true, result })
  } catch (e) {
    send({ id, ok: false, error: (e as Error).message })
  }
}

/**
 * Resolves with the first state accepted by `done`, forwarding the others to `onChange`.
 * The current state counts unless `skipCurrent` is set.
 */
function waitForState(
  session: RecordingSession,
  done: (state: AppState) => boolean,
  onChange: (state: AppState) => void,
  subscribe: Subscribe,
  skipCurrent = false
): Promise<AppState> {
  if (!skipCurrent && done(session.state)) return Promise.resolve(session.state)
  return new Promise((resolve) => {
    const unsubscribe = subscribe((state) => {
      if (done(state)) {
        unsubscribe()
        resolve(state)
      } else {
        onChange(state)
      }
    })
  })
}

async function handle(req: ControlRequest, { session, startRecording }: ControlDeps, onChange: (state: AppState) => void, subscribe: Subscribe): Promise<unknown> {
  switch (req.cmd) {
    case 'status':
      return session.state
    case 'settings':
      return getSettings()
    case 'displays':
      return listDisplays()
    case 'start': {
      if (starting || session.isBusy || session.state.status === 'selecting') throw new Error('a recording is already in progress')
      if (req.mode !== 'screen' && req.mode !== 'region') throw new Error(`unknown mode "${String(req.mode)}"`)
      const { cmd: _cmd, id: _id, ...request } = req
      starting = true
      try {
        // Subscribe before starting so the client sees the selection and countdown states
        // too; the reply is the first state after those (recording, or error, or idle when
        // the region selection was cancelled). The session guarantees the transition: it
        // fails by itself when the engine does not start in time.
        const settled = waitForState(session, (s) => s.status !== 'countdown' && s.status !== 'selecting', onChange, subscribe, true)
        await startRecording(request)
        return await settled
      } finally {
        starting = false
      }
    }
    case 'stop': {
      const status = session.state.status
      if (status !== 'recording' && status !== 'countdown') throw new Error('no recording in progress')
      session.requestStop()
      if (req.wait === false) return session.state
      // Processing (conversion, transcription) has no upper bound: the client decides how long to wait.
      return waitForState(session, (s) => s.status === 'done' || s.status === 'error' || s.status === 'idle', onChange, subscribe)
    }
    default:
      throw new Error(`unknown command "${String((req as { cmd: unknown }).cmd)}"`)
  }
}
