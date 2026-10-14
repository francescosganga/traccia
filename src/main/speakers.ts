import { app, net, utilityProcess, type UtilityProcess } from 'electron'
import { createHash } from 'crypto'
import { createWriteStream, existsSync } from 'fs'
import { copyFile, mkdir, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import { t } from '../shared/i18n'
import type { SpeakerModelStatus, SpeakerTurn } from '../shared/types'

const run = promisify(execFile)
const ROOT = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/'
const FILES = [
  { name: 'segmentation.tar.bz2', url: ROOT + 'speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2', hash: '24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488' },
  { name: 'embedding.onnx', url: ROOT + 'speaker-recongition-models/nemo_en_titanet_small.onnx', hash: 'ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e' }
]
const modelDir = () => join(app.getPath('userData'), 'models', 'speakers-v1')
let download: AbortController | null = null
let status: SpeakerModelStatus = { installed: false, downloading: false, progress: 0 }
let worker: UtilityProcess | null = null
let rejectWorker: ((error: Error) => void) | null = null

export function speakerStatus(): SpeakerModelStatus {
  return { ...status, installed: ['ready', 'segmentation/model.onnx', 'embedding.onnx'].every((name) => existsSync(join(modelDir(), name))) }
}

export function cancelSpeakerDownload(): void {
  download?.abort()
}

/** Checksums pin the public model downloads; no account or credentials are used. */
export async function downloadSpeakers(report: (s: SpeakerModelStatus) => void): Promise<void> {
  if (download) return
  download = new AbortController()
  const signal = download.signal
  const staging = modelDir() + '.download'
  const update = (patch: Partial<SpeakerModelStatus>) => {
    status = { ...status, ...patch }
    report(speakerStatus())
  }
  update({ downloading: true, progress: 0, error: undefined })
  try {
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })
    for (const [index, file] of FILES.entries()) {
      const response = await net.fetch(file.url, { signal })
      if (!response.ok || !response.body) throw new Error(`model download: HTTP ${response.status}`)
      const size = Number(response.headers.get('content-length'))
      let received = 0
      let lastReport = 0
      const hash = createHash('sha256')
      const progress = new Transform({ transform(chunk: Buffer, _encoding, done) {
        hash.update(chunk)
        received += chunk.length
        if (Date.now() - lastReport > 250) {
          update({ progress: (index + (size > 0 ? Math.min(received / size, 1) : 0)) / FILES.length })
          lastReport = Date.now()
        }
        done(null, chunk)
      } })
      await pipeline(Readable.from(response.body), progress, createWriteStream(join(staging, file.name)), { signal })
      if (hash.digest('hex') !== file.hash) throw new Error('speaker model checksum mismatch')
    }
    signal.throwIfAborted()
    await run('/usr/bin/tar', ['-xjf', join(staging, 'segmentation.tar.bz2'), '-C', staging])
    await rename(join(staging, 'sherpa-onnx-pyannote-segmentation-3-0'), join(staging, 'segmentation'))
    await rm(join(staging, 'segmentation.tar.bz2'))
    const resources = app.isPackaged ? join(process.resourcesPath, 'resources') : join(__dirname, '../../resources')
    await copyFile(join(resources, 'speaker-models-NOTICE.txt'), join(staging, 'NOTICE.txt'))
    await writeFile(join(staging, 'ready'), '1')
    signal.throwIfAborted()
    if (!speakerStatus().installed) {
      await rm(modelDir(), { recursive: true, force: true })
      await rename(staging, modelDir())
    }
    update({ progress: 1 })
  } catch (error) {
    if (!signal.aborted) {
      console.error('speaker model download failed', error)
      update({ error: t('speakers.downloadFailed') })
    }
  } finally {
    await rm(staging, { recursive: true, force: true })
    download = null
    update({ downloading: false })
  }
}

export function cancelDiarization(): void {
  rejectWorker?.(new Error('cancelled'))
}

export function diarize(audioPath: string): Promise<SpeakerTurn[]> {
  if (!speakerStatus().installed) return Promise.reject(new Error(t('speakers.missing')))
  if (worker) return Promise.reject(new Error('speaker worker busy'))
  return new Promise((resolve, reject) => {
    const w = utilityProcess.fork(join(__dirname, 'speaker-worker.js'), [], { serviceName: 'speakers', stdio: 'pipe' })
    worker = w
    const finish = (error?: Error, turns?: SpeakerTurn[]) => {
      if (worker !== w) return
      worker = null
      rejectWorker = null
      w.kill()
      if (error) reject(error)
      else resolve(turns ?? [])
    }
    rejectWorker = (error) => finish(error)
    w.stderr?.on('data', (chunk) => console.error('[speakers]', chunk.toString().trim()))
    w.on('message', (message: { turns?: SpeakerTurn[]; error?: string }) => finish(message.error ? new Error(message.error) : undefined, message.turns))
    w.on('exit', (code) => finish(new Error(`speaker worker exited: ${code}`)))
    w.postMessage({ audioPath, modelDir: modelDir() })
  })
}
