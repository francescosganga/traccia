/**
 * Protocol of the control socket (see src/main/control.ts): one JSON object per line in
 * both directions. Every request may carry an `id` that the reply echoes, so a client can
 * pipeline requests on one connection. While a request is pending the server may send
 * `event` lines (state changes) before the final `ok` reply.
 */
import type { AppState, DisplayInfo, RecordingRequest, Settings } from './types'

export type ControlRequest =
  | { id?: number; cmd: 'status' }
  | ({ id?: number; cmd: 'start' } & RecordingRequest)
  | { id?: number; cmd: 'stop'; wait?: boolean }
  | { id?: number; cmd: 'settings' }
  | { id?: number; cmd: 'displays' }

export interface ControlResults {
  status: AppState
  /** The state once the recording is running (or failed, or the region selection was cancelled) */
  start: AppState
  /** With wait (the default): the state once processing finished, i.e. done, error or idle */
  stop: AppState
  settings: Settings
  displays: DisplayInfo[]
}

export type ControlResponse<R = unknown> = { id?: number; ok: true; result: R } | { id?: number; ok: false; error: string }

export type ControlEvent = { id?: number; event: 'state'; state: AppState }

export type ControlMessage = ControlResponse | ControlEvent
