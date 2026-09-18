import { existsSync, readdirSync, realpathSync, statSync } from 'fs'
import { copyFile, link, mkdir, rm } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { WhisperModelId } from '../shared/types'

/** Files transformers.js needs for a q8 Whisper pipeline, relative to the model folder. */
export const MODEL_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx'
]

export function hfRepo(id: WhisperModelId): string {
  return `onnx-community/whisper-${id}_timestamped`
}

/** Hugging Face Hub cache folders, honouring HF_HUB_CACHE / HF_HOME like the Python tools do. */
export function hfCacheDirs(): string[] {
  const dirs = [
    process.env.HF_HUB_CACHE,
    process.env.HF_HOME ? join(process.env.HF_HOME, 'hub') : undefined,
    join(homedir(), '.cache', 'huggingface', 'hub')
  ].filter((d): d is string => !!d)
  return [...new Set(dirs)].filter((d) => existsSync(d))
}

function hasAllFiles(dir: string): boolean {
  return MODEL_FILES.every((f) => existsSync(join(dir, f)))
}

/**
 * Looks for a complete copy of the model in the Hugging Face Hub cache
 * (`models--onnx-community--whisper-base_timestamped/snapshots/<rev>/…`).
 * Returns the snapshot folder, or null.
 */
export function findInHfCache(id: WhisperModelId): string | null {
  const repoDir = `models--${hfRepo(id).replace('/', '--')}`
  for (const cache of hfCacheDirs()) {
    const snapshots = join(cache, repoDir, 'snapshots')
    if (!existsSync(snapshots)) continue
    const candidates = readdirSync(snapshots)
      .map((rev) => join(snapshots, rev))
      .filter((dir) => statSync(dir).isDirectory() && hasAllFiles(dir))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    if (candidates[0]) return candidates[0]
  }
  return null
}

/**
 * Imports a cached snapshot into `dest`. Files are hard-linked when possible (no extra
 * disk space, and deleting our copy never touches the user's cache), otherwise copied.
 */
export async function importFromHfCache(snapshot: string, dest: string, onProgress: (fraction: number, file: string) => void): Promise<void> {
  await rm(dest, { recursive: true, force: true })
  for (let i = 0; i < MODEL_FILES.length; i++) {
    const file = MODEL_FILES[i]
    onProgress(i / MODEL_FILES.length, file)
    // Snapshot entries are symlinks into the blobs folder; link the real file.
    const source = realpathSync(join(snapshot, file))
    const target = join(dest, file)
    await mkdir(dirname(target), { recursive: true })
    try {
      await link(source, target)
    } catch {
      await copyFile(source, target)
    }
  }
  onProgress(1, '')
}
