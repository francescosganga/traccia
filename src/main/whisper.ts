import { app, utilityProcess, type UtilityProcess } from 'electron'
import { existsSync, readdirSync, statSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { t, type TranslationKey } from '../shared/i18n'
import type { TranscriptResult, WhisperModelId, WhisperModelInfo } from '../shared/types'
import { MODEL_FILES, findInHfCache, importFromHfCache } from './model-cache'

export const MODELS: Omit<WhisperModelInfo, 'installed' | 'sizeOnDisk' | 'description'>[] = [
  { id: 'tiny', label: 'Tiny', sizeLabel: '≈ 40 MB' },
  { id: 'base', label: 'Base', sizeLabel: '≈ 75 MB' },
  { id: 'small', label: 'Small', sizeLabel: '≈ 250 MB' },
  { id: 'large-v3-turbo', label: 'Large v3 Turbo', sizeLabel: '≈ 1.1 GB' }
]

export function modelsDir(): string {
  return join(app.getPath('userData'), 'models')
}

function modelDir(id: WhisperModelId): string {
  return join(modelsDir(), 'onnx-community', `whisper-${id}_timestamped`)
}

/** Removes model folders downloaded by older versions (without word-level timestamps). */
export async function cleanupLegacyModels(): Promise<void> {
  for (const m of MODELS) await rm(join(modelsDir(), 'onnx-community', `whisper-${m.id}`), { recursive: true, force: true }).catch(() => {})
}

function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    total += entry.isDirectory() ? dirSize(p) : statSync(p).size
  }
  return total
}

export function isModelInstalled(id: WhisperModelId): boolean {
  const d = modelDir(id)
  return MODEL_FILES.every((f) => existsSync(join(d, f)))
}

export function listModels(): WhisperModelInfo[] {
  return MODELS.map((m) => {
    const installed = isModelInstalled(m.id)
    return {
      ...m,
      description: t(`model.${m.id}.desc` as TranslationKey),
      installed,
      sizeOnDisk: dirSize(modelDir(m.id)),
      cachedPath: installed ? undefined : (findInHfCache(m.id) ?? undefined)
    }
  })
}

export async function deleteModel(id: WhisperModelId): Promise<void> {
  killWorker()
  await rm(modelDir(id), { recursive: true, force: true })
}

export async function deleteAllModels(): Promise<void> {
  killWorker()
  await rm(modelsDir(), { recursive: true, force: true })
}

// ---- worker management ------------------------------------------------------

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (p: number, file?: string) => void }
let worker: UtilityProcess | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function getWorker(): UtilityProcess {
  if (worker) return worker
  const w = utilityProcess.fork(join(__dirname, 'whisper-worker.js'), [], {
    serviceName: 'whisper',
    env: { ...process.env, MODELS_DIR: modelsDir() },
    stdio: 'pipe'
  })
  w.stdout?.on('data', (d) => console.log('[whisper]', d.toString().trim()))
  w.stderr?.on('data', (d) => console.error('[whisper]', d.toString().trim()))
  w.on('message', (msg: { id: number; type: string; progress?: number; file?: string; result?: unknown; error?: string }) => {
    const p = pending.get(msg.id)
    if (!p) return
    if (msg.type === 'progress') p.onProgress?.(msg.progress ?? 0, msg.file)
    else if (msg.type === 'result') {
      pending.delete(msg.id)
      p.resolve(msg.result)
    } else if (msg.type === 'error') {
      pending.delete(msg.id)
      p.reject(new Error(msg.error))
    }
  })
  w.on('exit', (code) => {
    console.log('[whisper] worker exited', code)
    worker = null
    for (const p of pending.values()) p.reject(new Error(t('err.whisperCrashed')))
    pending.clear()
  })
  worker = w
  return w
}

export function killWorker(): void {
  if (!worker) return
  const w = worker
  worker = null
  for (const p of pending.values()) p.reject(new Error('cancelled'))
  pending.clear()
  w.kill()
}

function request<T>(msg: Record<string, unknown>, onProgress?: Pending['onProgress']): Promise<T> {
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress })
    getWorker().postMessage({ id, ...msg })
  })
}

/** Installs a model: imported from the Hugging Face cache when present, downloaded otherwise. */
export async function downloadModel(id: WhisperModelId, onProgress: (p: number, file?: string) => void): Promise<void> {
  const snapshot = findInHfCache(id)
  if (snapshot) {
    await importFromHfCache(snapshot, modelDir(id), onProgress)
    return
  }
  await request<void>({ type: 'download', model: id }, onProgress)
}

/** Cancels a running download and removes partial files. */
export async function cancelDownload(id: WhisperModelId): Promise<void> {
  killWorker()
  if (!isModelInstalled(id)) await rm(modelDir(id), { recursive: true, force: true })
}

export function transcribe(
  audioPath: string,
  model: WhisperModelId,
  language: string,
  onProgress: (p: number) => void
): Promise<TranscriptResult> {
  return request<TranscriptResult>({ type: 'transcribe', model, audioPath, language }, (p) => onProgress(p))
}
