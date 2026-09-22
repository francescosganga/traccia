import { execFile } from 'child_process'
import { createConnection, type Socket } from 'net'
import type { ControlMessage, ControlRequest, ControlResults } from '../../../src/shared/control'
import { APP_NAME, controlSocketPath } from '../../../src/shared/recording-reader'
import type { AppState } from '../../../src/shared/types'

const LAUNCH_TIMEOUT = 20_000

/** The app is not listening on the control socket. */
export class NotRunningError extends Error {
  constructor(public readonly socketPath: string) {
    super(
      `${APP_NAME} is not running (no control socket at ${socketPath}). Open the app first` +
        (process.platform === 'darwin' ? ', or pass --launch.' : '.')
    )
    this.name = 'NotRunningError'
  }
}

type Pending = { resolve: (result: unknown) => void; reject: (e: Error) => void; onState?: (state: AppState) => void }

/** One connection to the app's control socket; requests are matched to replies by id. */
export class ControlClient {
  private buffer = ''
  private nextId = 1
  private pending = new Map<number, Pending>()

  private constructor(private socket: Socket) {
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => this.onData(chunk))
    socket.on('close', () => this.failAll(new Error(`connection to ${APP_NAME} closed`)))
    socket.on('error', (e) => this.failAll(e))
  }

  static connect(path = controlSocketPath()): Promise<ControlClient> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(path)
      socket.once('connect', () => resolve(new ControlClient(socket)))
      socket.once('error', (e: NodeJS.ErrnoException) => {
        reject(e.code === 'ENOENT' || e.code === 'ECONNREFUSED' ? new NotRunningError(path) : e)
      })
    })
  }

  /** Like connect, but starts the app when it is not running (macOS only) and waits for its socket. */
  static async connectOrLaunch(path = controlSocketPath(), launch = false): Promise<ControlClient> {
    try {
      return await ControlClient.connect(path)
    } catch (e) {
      if (!(e instanceof NotRunningError) || !launch) throw e
    }
    if (process.platform !== 'darwin') throw new Error('--launch is only supported on macOS')
    await new Promise<void>((resolve, reject) => {
      execFile('open', ['-a', APP_NAME], (err) => (err ? reject(new Error(`cannot launch ${APP_NAME}: ${err.message}`)) : resolve()))
    })
    const deadline = Date.now() + LAUNCH_TIMEOUT
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500))
      try {
        return await ControlClient.connect(path)
      } catch (e) {
        if (!(e instanceof NotRunningError)) throw e
      }
    }
    throw new Error(`${APP_NAME} did not start within ${LAUNCH_TIMEOUT / 1000} seconds`)
  }

  request<C extends ControlRequest['cmd']>(
    req: Extract<ControlRequest, { cmd: C }>,
    onState?: (state: AppState) => void
  ): Promise<ControlResults[C]> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (r: unknown) => void, reject, onState })
      this.socket.write(JSON.stringify({ ...req, id }) + '\n')
    })
  }

  close(): void {
    this.socket.end()
    this.socket.destroy()
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let nl = this.buffer.indexOf('\n')
    while (nl >= 0) {
      const line = this.buffer.slice(0, nl).trim()
      this.buffer = this.buffer.slice(nl + 1)
      if (line) this.onMessage(JSON.parse(line) as ControlMessage)
      nl = this.buffer.indexOf('\n')
    }
  }

  private onMessage(msg: ControlMessage): void {
    if (msg.id === undefined) return
    const p = this.pending.get(msg.id)
    if (!p) return
    if ('event' in msg) {
      p.onState?.(msg.state)
      return
    }
    this.pending.delete(msg.id)
    if (msg.ok) p.resolve(msg.result)
    else p.reject(new Error(msg.error))
  }

  private failAll(e: Error): void {
    for (const p of this.pending.values()) p.reject(e)
    this.pending.clear()
  }
}
