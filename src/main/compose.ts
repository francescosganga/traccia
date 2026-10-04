// The ffmpeg graphs that lay the webcam over the screen and mix in the system audio. Kept free of electron imports so they can be tested.
import type { Rect } from '../shared/types'
import { compactLayout, webcamRadius, webcamRect, type WebcamLayoutEvent, type WebcamShape } from '../shared/webcam'

/** A layout change with the rectangle the webcam takes in the output, in pixels. */
export interface PlacedLayout extends WebcamLayoutEvent {
  rect: Rect
}

export function placeLayout(events: WebcamLayoutEvent[], width: number, height: number): PlacedLayout[] {
  return compactLayout(events).map((e) => ({ ...e, rect: webcamRect(e.shape, e.corner, width, height) }))
}

interface Segment {
  start: number
  /** Infinity for the last one */
  end: number
  rect: Rect
}

const sec = (ms: number) => (ms / 1000).toFixed(3)

/** Alpha mask of a rounded rectangle (a circle when the radius is half the side), antialiased over one pixel. */
function mask(width: number, height: number, radius: number): string {
  const r = radius.toFixed(1)
  const d = `hypot(max(abs(X+0.5-W/2)-(W/2-${r}),0),max(abs(Y+0.5-H/2)-(H/2-${r}),0))`
  return `color=c=black:s=${width}x${height}:r=1:d=1,format=gray,geq=lum='255*clip(${r}-${d}+0.5,0,1)'`
}

/** Piecewise value over the segments of one shape; outside them the overlay is disabled, so the last value can stand. */
function piecewise(segments: Segment[], value: (s: Segment) => number): string {
  let expr = String(value(segments[segments.length - 1]))
  for (let i = segments.length - 2; i >= 0; i--) expr = `if(lt(t,${sec(segments[i].end)}),${value(segments[i])},${expr})`
  return expr
}

export interface WebcamGraphInput {
  /** Crop and scale of the screen (input 0), as for the video without the webcam */
  screenFilters: string[]
  layout: WebcamLayoutEvent[]
  width: number
  height: number
  /** The webcam (input 1) is cut there, so it cannot make the video longer than the screen */
  durationMs: number
}

/**
 * filter_complex with the screen as input 0 and the webcam as input 1 (already shifted to
 * the screen's clock with -itsoffset); the result is labelled [vout]. Each shape used gets
 * one branch: cropped to its aspect, scaled, masked, then overlaid only while it is shown,
 * at the corner of the moment. Null when the webcam is never visible.
 */
export function webcamGraph({ screenFilters, layout, width, height, durationMs }: WebcamGraphInput): string | null {
  const placed = placeLayout(layout, width, height)
  const byShape = new Map<WebcamShape, Segment[]>()
  placed.forEach((e, i) => {
    if (!e.visible) return
    const segments = byShape.get(e.shape) ?? []
    segments.push({ start: e.t, end: placed[i + 1]?.t ?? Infinity, rect: e.rect })
    byShape.set(e.shape, segments)
  })
  if (byShape.size === 0) return null

  const parts = [`[0:v]${screenFilters.length ? screenFilters.join(',') : 'null'}[base]`]
  const shapes = [...byShape.keys()]
  const branches = shapes.map((_, i) => `[c${i}]`)
  parts.push(`[1:v]trim=end=${sec(durationMs)}${shapes.length > 1 ? `,split=${shapes.length}` : ''}${branches.join('')}`)
  let below = '[base]'
  shapes.forEach((shape, i) => {
    const segments = byShape.get(shape)!
    const { width: w, height: h } = segments[0].rect
    const aspect = (w / h).toFixed(4)
    parts.push(`[c${i}]crop='min(iw,ih*${aspect})':'min(ih,iw/${aspect})',scale=${w}:${h},setsar=1,format=yuva420p[s${i}]`)
    parts.push(`${mask(w, h, webcamRadius(shape, h))}[m${i}]`)
    parts.push(`[s${i}][m${i}]alphamerge[w${i}]`)
    const enable = segments.map((s) => (s.end === Infinity ? `gte(t,${sec(s.start)})` : `between(t,${sec(s.start)},${sec(s.end)})`)).join('+')
    const out = i === shapes.length - 1 ? '[vout]' : `[v${i}]`
    parts.push(`${below}[w${i}]overlay=x='${piecewise(segments, (s) => s.rect.x)}':y='${piecewise(segments, (s) => s.rect.y)}':enable='${enable}':eval=frame${out}`)
    below = out
  })
  return parts.join(';')
}

export interface SystemAudioInput {
  /** ffmpeg input index of the system audio file */
  input: number
  /** Seconds between the screen's start and the system audio recorder's (negative: it started first) */
  offset: number
  /** The screen recording (input 0) has the microphone: the two are mixed */
  withMic: boolean
  durationMs: number
}

/**
 * Audio part of a filter_complex, labelled [aout]: the system audio lined up on the screen's
 * clock and mixed with the microphone at full level (amix would halve both), through a
 * limiter so a loud video under the voice does not clip. Both are made stereo first, or amix
 * would fold the system audio into the microphone's mono. Alone, it is cut at the duration.
 */
const STEREO = 'aformat=channel_layouts=stereo'

export function systemAudioFilter({ input, offset, withMic, durationMs }: SystemAudioInput): string {
  const shift = offset >= 0 ? `adelay=delays=${Math.round(offset * 1000)}:all=1` : `atrim=start=${(-offset).toFixed(3)},asetpts=PTS-STARTPTS`
  const system = `[${input}:a]asetpts=PTS-STARTPTS,${shift}`
  return withMic
    ? `${system},${STEREO}[sys];[0:a]${STEREO}[mic];[mic][sys]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95:level=false[aout]`
    : `${system},atrim=end=${sec(durationMs)}[aout]`
}
