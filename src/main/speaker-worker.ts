// A separate process keeps the native ONNX runtimes and CPU work away from Electron and Whisper.
import { readFileSync } from 'fs'
import { join } from 'path'
import type { SpeakerTurn } from '../shared/types'
import { clusterVoices, type VoiceSample } from './speaker-clustering'

const sherpa = require('sherpa-onnx-node') as {
  OfflineSpeakerDiarization: new (config: Record<string, unknown>) => {
    process(samples: Float32Array): { start: number; end: number; speaker: number }[]
  }
  SpeakerEmbeddingExtractor: new (config: Record<string, unknown>) => {
    createStream(): { acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void; inputFinished(): void }
    isReady(stream: unknown): boolean
    compute(stream: unknown, external: boolean): Float32Array
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
    // Keep segmentation boundaries, but rebuild identities from sustained speech rather than tiny turns.
    const raw = diarizer.process(samples).sort((a, b) => a.start - b.start)
    const extractor = new sherpa.SpeakerEmbeddingExtractor({ model: join(modelDir, 'embedding.onnx'), numThreads: 2, provider: 'cpu' })
    const voices: VoiceSample[] = []
    for (const turn of raw) {
      const duration = turn.end - turn.start
      const pieces = Math.max(1, Math.ceil(duration / 6))
      for (let i = 0; i < pieces; i++) {
        const start = turn.start + i * duration / pieces
        const end = turn.start + (i + 1) * duration / pieces
        const piece = samples.subarray(Math.floor(start * 16000), Math.floor(end * 16000))
        let energy = 0
        for (const value of piece) energy += value * value
        // The same conservative -60 dB floor as Whisper preparation excludes near-silent VAD errors.
        if (!piece.length || Math.sqrt(energy / piece.length) < 0.001) continue
        const stream = extractor.createStream()
        stream.acceptWaveform({ samples: piece, sampleRate: 16000 })
        stream.inputFinished()
        const embedding = extractor.isReady(stream) ? Array.from(extractor.compute(stream, false)) : []
        voices.push({ start, end, embedding })
      }
    }
    const turns: SpeakerTurn[] = clusterVoices(voices)
    process.parentPort.postMessage({ turns })
  } catch (error) {
    console.error('speaker recognition failed', error)
    process.parentPort.postMessage({ error: String(error) })
  }
})
