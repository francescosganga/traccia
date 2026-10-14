// A separate process keeps the native ONNX runtimes and CPU work away from Electron and Whisper.
import { readFileSync } from 'fs'
import { join } from 'path'
import type { SpeakerTurn } from '../shared/types'

const sherpa = require('sherpa-onnx-node') as {
  OfflineSpeakerDiarization: new (config: Record<string, unknown>) => {
    process(samples: Float32Array): { start: number; end: number; speaker: number }[]
  }
}

process.parentPort.on('message', (event) => {
  const { audioPath, modelDir } = event.data as { audioPath: string; modelDir: string }
  try {
    const diarizer = new sherpa.OfflineSpeakerDiarization({
      segmentation: { pyannote: { model: join(modelDir, 'segmentation', 'model.onnx') }, numThreads: 2, provider: 'cpu' },
      embedding: { model: join(modelDir, 'embedding.onnx'), numThreads: 2, provider: 'cpu' },
      clustering: { numClusters: -1, threshold: 0.9 },
      minDurationOn: 0.3,
      minDurationOff: 0.5
    })
    const buffer = readFileSync(audioPath)
    const samples = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
    // Cluster the whole source so labels do not reset at each Whisper chunk.
    const raw = diarizer.process(samples).sort((a, b) => a.start - b.start)
    const labels = new Map<number, string>()
    const turns: SpeakerTurn[] = raw.map((turn) => {
      if (!labels.has(turn.speaker)) labels.set(turn.speaker, String(labels.size + 1))
      return { start: turn.start, end: turn.end, speaker: labels.get(turn.speaker)! }
    })
    process.parentPort.postMessage({ turns })
  } catch (error) {
    console.error('speaker recognition failed', error)
    process.parentPort.postMessage({ error: String(error) })
  }
})
