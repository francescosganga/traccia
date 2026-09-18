import { existsSync } from 'fs'
import { readFile, readdir, stat } from 'fs/promises'
import { join } from 'path'
import type { RecordingEntry } from '../shared/types'

/** Lists past recordings (folders containing recording.json), newest first. */
export async function listRecordings(outputDir: string, limit = 20): Promise<RecordingEntry[]> {
  if (!existsSync(outputDir)) return []
  const entries: RecordingEntry[] = []
  for (const name of await readdir(outputDir)) {
    const dir = join(outputDir, name)
    const jsonPath = join(dir, 'recording.json')
    if (!existsSync(jsonPath)) continue
    try {
      const meta = JSON.parse(await readFile(jsonPath, 'utf8'))
      const s = await stat(jsonPath)
      entries.push({
        dir,
        name,
        createdAt: meta.createdAt ? Date.parse(meta.createdAt) : s.mtimeMs,
        format: meta.format,
        durationMs: meta.durationMs ?? 0,
        mediaPath: join(dir, meta.media ?? ''),
        txtPath: join(dir, 'recording.txt'),
        rawTxtPath: join(dir, 'recording-raw.txt')
      })
    } catch (e) {
      console.error('cannot read', jsonPath, e)
    }
  }
  return entries.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
}
