import type { SpeakerTurn } from '../shared/types'

export interface VoiceSample {
  start: number
  end: number
  embedding: number[]
}

const MIN_SAMPLE_SECONDS = 2.5
const MAX_ANCHORS = 600
const MERGE_SIMILARITY = 0.6

function dot(a: number[], b: number[]): number {
  let value = 0
  for (let i = 0; i < a.length; i++) value += a[i] * b[i]
  return value
}

function normalized(vector: number[]): number[] | undefined {
  const length = Math.sqrt(dot(vector, vector))
  if (!Number.isFinite(length) || length <= 0) return undefined
  return vector.map((v) => v / length)
}

function coveredSeconds(spans: { start: number; end: number }[]): number {
  let end = -Infinity
  let duration = 0
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    duration += Math.max(0, span.end - Math.max(end, span.start))
    end = Math.max(end, span.end)
  }
  return duration
}

/** TitaNet profiles require sustained speech; short interjections may match a profile but cannot create one. */
export function clusterVoices(input: VoiceSample[]): SpeakerTurn[] {
  const samples = [...input].sort((a, b) => a.start - b.start).map((s) => ({ ...s, embedding: normalized(s.embedding) }))
  const dimension = samples.find((s) => s.embedding)?.embedding?.length
  const candidates = samples.flatMap((s, index) =>
    s.embedding && s.embedding.length === dimension && s.end - s.start >= MIN_SAMPLE_SECONDS ? [index] : []
  )
  // Spread the bounded training set over the entire recording, including people who arrive late.
  const anchors = candidates.length <= MAX_ANCHORS ? candidates : Array.from({ length: MAX_ANCHORS }, (_, i) =>
    candidates[Math.round(i * (candidates.length - 1) / (MAX_ANCHORS - 1))]
  )
  type Group = { members: number[]; sum: number[]; count: number }
  const groups: (Group | null)[] = anchors.map((index) => ({ members: [index], sum: samples[index].embedding!.slice(), count: 1 }))
  const similarities = groups.map((a, i) => Float32Array.from(groups, (b, j) => i === j ? -1 : dot(a!.sum, b!.sum)))
  for (;;) {
    let best = MERGE_SIMILARITY
    let left = -1
    let right = -1
    for (let i = 0; i < groups.length; i++) {
      if (!groups[i]) continue
      for (let j = i + 1; j < groups.length; j++) {
        if (groups[j] && similarities[i][j] > best) {
          best = similarities[i][j]
          left = i
          right = j
        }
      }
    }
    if (left < 0) break
    const a = groups[left]!
    const b = groups[right]!
    for (let k = 0; k < groups.length; k++) {
      if (!groups[k] || k === left || k === right) continue
      similarities[left][k] = similarities[k][left] =
        (similarities[left][k] * a.count + similarities[right][k] * b.count) / (a.count + b.count)
    }
    a.members.push(...b.members)
    a.sum = a.sum.map((value, i) => value + b.sum[i])
    a.count += b.count
    groups[right] = null
  }

  const support = Math.min(10, Math.max(3, coveredSeconds(anchors.map((i) => samples[i])) * 0.15))
  const profiles = groups.filter((g): g is Group => g !== null && coveredSeconds(g.members.map((i) => samples[i])) >= support)
  const centers = profiles.map((g) => normalized(g.sum)!)
  const memberships = new Map<number, number>()
  profiles.forEach((group, profile) => group.members.forEach((index) => memberships.set(index, profile)))
  const labels = new Map<number, string>()
  return samples.map((sample, index) => {
    let profile = memberships.get(index)
    if (profile === undefined && sample.embedding && sample.embedding.length === dimension) {
      const ranked = centers.map((center, i) => ({ i, score: dot(center, sample.embedding!) })).sort((a, b) => b.score - a.score)
      // Ambiguous speech remains audible/transcribable with only its source label.
      if (ranked[0]?.score >= 0.25 && (!ranked[1] || ranked[0].score - ranked[1].score >= 0.05)) profile = ranked[0].i
    }
    if (profile !== undefined && !labels.has(profile)) labels.set(profile, String(labels.size + 1))
    return { start: sample.start, end: sample.end, speaker: profile === undefined ? undefined : labels.get(profile) }
  })
}
