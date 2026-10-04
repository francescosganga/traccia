// Where the webcam goes in the video. The same numbers place the bubble on screen (DIP)
// and the overlay in the output (pixels), so the bubble shows what the video will look like.
import type { Rect } from './types'

export type WebcamShape = 'circle' | 'square' | 'rectangle'
export type WebcamCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export const WEBCAM_SHAPES: WebcamShape[] = ['circle', 'square', 'rectangle']
export const WEBCAM_CORNERS: WebcamCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

export interface WebcamLayout {
  shape: WebcamShape
  corner: WebcamCorner
  visible: boolean
}

/** A layout and the instant it starts, in ms from the start of the recording. */
export interface WebcamLayoutEvent extends WebcamLayout {
  t: number
}

// Shares of the shorter side of the recorded area: the side of the circle and the square
// (the height of the rectangle), and the distance from the edges.
const SIZE = 0.26
const MARGIN = 0.03
const RECTANGLE_ASPECT = 16 / 9
// Corner radius of the square and the rectangle, as a share of their height
const ROUNDING = 0.16

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/** The webcam's rectangle inside an area of `width` × `height`, in the same unit. */
export function webcamRect(shape: WebcamShape, corner: WebcamCorner, width: number, height: number): Rect {
  const base = Math.min(width, height)
  const margin = Math.round(base * MARGIN)
  const h = even(base * SIZE)
  // A rectangle in a tall, narrow region would not fit: it gets as wide as the region allows
  const w = shape === 'rectangle' ? Math.min(even(h * RECTANGLE_ASPECT), even(width - 2 * margin - 1)) : h
  return {
    x: corner.endsWith('left') ? margin : width - w - margin,
    y: corner.startsWith('top') ? margin : height - h - margin,
    width: w,
    height: h
  }
}

/** Corner radius for a webcam of that height: a circle is a square rounded all the way. */
export function webcamRadius(shape: WebcamShape, height: number): number {
  return shape === 'circle' ? height / 2 : Math.round(height * ROUNDING)
}

/** Drops events that change nothing, so the compositing graph stays as small as the changes. */
export function compactLayout<T extends WebcamLayoutEvent>(events: T[]): T[] {
  const out: T[] = []
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    const last = out[out.length - 1]
    if (last && last.t === e.t) out[out.length - 1] = e
    else if (!last || last.shape !== e.shape || last.corner !== e.corner || last.visible !== e.visible) out.push(e)
  }
  return out
}
