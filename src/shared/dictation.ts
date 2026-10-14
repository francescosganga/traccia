import type { InputDevice, SpeechLanguage, WhisperModelId } from './types'

export type DictationPhase = 'ready' | 'preparing' | 'listening' | 'stopping' | 'transcribing' | 'result' | 'error' | 'inserting' | 'done'
export interface DictationTarget {
  name: string
  token?: string
  reason?: 'permission' | 'destination' | 'unavailable'
}
export interface DictationState {
  phase: DictationPhase
  text: string
  target: DictationTarget | null
  message: string
  warning: string
  startedAt: number | null
  retry: boolean
}
export interface DictationCapture {
  id: number
  mic: InputDevice | null
}
export interface DictationPreferences {
  mic: InputDevice | null
  model: WhisperModelId
  language: SpeechLanguage
}

export const dictationActive = (phase: DictationPhase): boolean => ['preparing', 'listening', 'stopping', 'transcribing', 'inserting'].includes(phase)
export const DICTATION_MAX_MS = 5 * 60_000
export const DICTATION_MAX_TEXT = 50_000
