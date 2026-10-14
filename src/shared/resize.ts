import type { OutputFormat, Resolution } from './types'

export type ResizeResolution = Exclude<Resolution, 'native'>
const TARGETS: ResizeResolution[] = ['1080', '720', '480']

/** Uses the same height limits as capture, including portrait and region recordings. */
export function resizeOptions(format: OutputFormat, width: number, height: number): ResizeResolution[] {
  if (format === 'm4a' || !Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) return []
  return TARGETS.filter((target) => Number(target) < height && Math.round(width * Number(target) / height) >= 2)
}

export function resizedDimensions(width: number, height: number, target: ResizeResolution): { width: number; height: number } {
  if (!resizeOptions('mp4', width, height).includes(target)) throw new RangeError('invalid resize resolution')
  return { width: Math.max(2, Math.floor(Math.round(width * Number(target) / height) / 2) * 2), height: Number(target) }
}
