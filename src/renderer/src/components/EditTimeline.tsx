import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { canMoveBoundary, partAt, partStarts, type EditPart } from '../../../shared/edit-list'
import { t } from '../../../shared/i18n'
import { mediaUrl } from '../../../shared/media-url'
import { formatTime } from '../../../shared/time'
import type { RecordingMedia } from '../../../shared/types'
import type { WebcamLayout, WebcamLayoutEvent } from '../../../shared/webcam'
import { Icon } from './Icon'

/** The tracks of the editor: what an action on a part acts on. */
export type Track = 'screen' | 'webcam' | 'audio'

export interface Selection {
  track: Track
  /** The part clicked first: Shift-click selects from it */
  anchor: number
  /** Consecutive, in order */
  indices: number[]
}

interface Props {
  dir: string
  media: RecordingMedia
  parts: EditPart[]
  selection: Selection | null
  /** Playhead, ms of the axis (the parts side by side, see shared/edit-list.ts) */
  time: number
  playing: boolean
  onSeek: (ms: number) => void
  onSelect: (track: Track, index: number, extend: boolean) => void
  onMove: (indices: number[], before: number) => void
  /** A boundary is about to be dragged: once per drag, before the onBoundary calls */
  onBoundaryStart: () => void
  onBoundary: (i: number, ms: number) => void
  /** Shown left of the zoom buttons, above the timeline (play button, time, undo) */
  controls: ReactNode
}

// Steps the ruler snaps to
const STEPS = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000]
const step = (atLeast: number) => STEPS.find((s) => s >= atLeast) ?? STEPS[STEPS.length - 1]
// Height of .timeline-strip
const STRIP_PX = 48
const LABEL_PX = 80
// Fully zoomed in, the view spans this much
const MIN_VIEW_MS = 2000
// A press on a part that moves further than this drags the part
const DRAG_PX = 5

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const pct = (ms: number, of: number) => `${(ms / of) * 100}%`

/** The frame on screen at `ms`: the last one taken at or before it. */
export function frameAt(frames: RecordingMedia['frames'], ms: number): RecordingMedia['frames'][number] | undefined {
  let found = frames[0]
  for (const f of frames) {
    if (f.tMs > ms) break
    found = f
  }
  return found
}

/** A stretch of a part with one webcam layout: the part's own, or the recorded one's changes inside it. */
export interface LayoutRun {
  from: number
  to: number
  layout: WebcamLayout
  /** Chosen in the editor, not recorded */
  own: boolean
}

export function layoutRuns(p: EditPart, recorded: WebcamLayoutEvent[]): LayoutRun[] {
  if (p.webcam) return [{ from: p.from, to: p.to, layout: p.webcam, own: true }]
  const runs: LayoutRun[] = []
  let current = recorded.filter((e) => e.t <= p.from).pop() ?? recorded[0]
  let from = p.from
  for (const e of recorded) {
    if (e.t <= p.from || e.t >= p.to) continue
    runs.push({ from, to: e.t, layout: current, own: false })
    current = e
    from = e.t
  }
  runs.push({ from, to: p.to, layout: current, own: false })
  return runs
}

const layoutLabel = (l: WebcamLayout) => (l.visible ? `${t(`webcam.${l.shape}`)}, ${t(`webcam.corner.${l.corner}`)}` : t('edit.webcamHidden'))

type Drag =
  | { kind: 'scrub' }
  | { kind: 'boundary'; i: number }
  | { kind: 'part'; x: number; indices: number[]; moving: boolean }

/**
 * The recording on one axis, cut into its parts in the order they play: a strip of thumbnails,
 * the webcam, the audio with what was said, the clicks. Clicking a part selects it on that track
 * and moves the playhead there; dragging a part of the strip moves it, dragging a boundary between
 * parts that continue each other moves the cut. The ruler moves the playhead. Pinch or ⌘ + wheel
 * zooms, a horizontal swipe scrolls.
 */
export function EditTimeline({ dir, media, parts, selection, time, playing, onSeek, onSelect, onMove, onBoundaryStart, onBoundary, controls }: Props) {
  const duration = media.durationMs
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  // For the wheel listener, registered once
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const [view, setView] = useState({ left: 0, width: 0 })
  const anchor = useRef<{ ms: number; x: number } | null>(null)
  const drag = useRef<Drag | null>(null)
  // Where a dragged part would go: the axis ms of the gap, and the index of the part after it
  const [insert, setInsert] = useState<{ ms: number; before: number } | null>(null)
  const thumbs = useRef(new Map<number, string | null>())
  const [, setThumbsLoaded] = useState(0)
  const starts = partStarts(parts)

  const maxZoom = Math.max(1, duration / MIN_VIEW_MS)
  const pxPerMs = (view.width * zoom) / duration || 0
  const measure = () => {
    const vp = viewport.current
    if (vp) setView({ left: vp.scrollLeft, width: vp.clientWidth })
  }

  useLayoutEffect(() => {
    measure()
    const observer = new ResizeObserver(measure)
    if (viewport.current) observer.observe(viewport.current)
    return () => observer.disconnect()
  }, [])

  /** Zooms keeping the instant `ms` under the same point of the view (`x` px from its left). */
  const zoomTo = (next: number, ms: number, x: number) => {
    anchor.current = { ms, x }
    setZoom(clamp(next, 1, maxZoom))
  }
  useLayoutEffect(() => {
    const vp = viewport.current
    const a = anchor.current
    if (!vp || !a) return
    anchor.current = null
    vp.scrollLeft = (a.ms / duration) * vp.clientWidth * zoom - a.x
    measure()
  }, [zoom])

  // Native listener: React's wheel handlers are passive and could not keep the page from scrolling
  useEffect(() => {
    const vp = viewport.current
    if (!vp) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        // A trackpad pinch arrives as a wheel event with ctrlKey
        e.preventDefault()
        const rect = vp.getBoundingClientRect()
        const x = e.clientX - rect.left
        const ms = ((vp.scrollLeft + x) / (vp.clientWidth * zoomRef.current)) * duration
        zoomTo(zoomRef.current * Math.exp(-e.deltaY * 0.01), ms, x)
      } else if (zoomRef.current > 1 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault()
        vp.scrollLeft += e.deltaY
      }
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [duration, maxZoom])

  /** The +/− buttons zoom around the playhead when it is in view, otherwise around the middle. */
  const zoomBy = (factor: number) => {
    const vp = viewport.current
    if (!vp) return
    const contentWidth = vp.clientWidth * zoom
    const playheadX = (time / duration) * contentWidth - vp.scrollLeft
    const x = playheadX >= 0 && playheadX <= vp.clientWidth ? playheadX : vp.clientWidth / 2
    zoomTo(zoom * factor, ((vp.scrollLeft + x) / contentWidth) * duration, x)
  }

  // While playing zoomed in, the view follows the playhead
  useEffect(() => {
    const vp = viewport.current
    if (!playing || !vp || zoom === 1) return
    const x = (time / duration) * vp.clientWidth * zoom
    if (x < vp.scrollLeft || x > vp.scrollLeft + vp.clientWidth) vp.scrollLeft = x - vp.clientWidth * 0.1
  }, [time, playing])

  const timeAt = (clientX: number) => {
    const rect = content.current!.getBoundingClientRect()
    return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration)
  }

  /** The gap between parts nearest to `ms`: where a dragged part goes. */
  const gapAt = (ms: number): { ms: number; before: number } => {
    let best = { ms: 0, before: 0 }
    for (let k = 1; k <= parts.length; k++) {
      const at = k < parts.length ? starts[k] : duration
      if (Math.abs(at - ms) < Math.abs(best.ms - ms)) best = { ms: at, before: k }
    }
    return best
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    const ms = timeAt(e.clientX)
    const boundary = target.closest<HTMLElement>('[data-boundary]')
    const lane = target.closest<HTMLElement>('[data-track]')
    if (boundary) {
      drag.current = { kind: 'boundary', i: Number(boundary.dataset.boundary) }
      onBoundaryStart()
    } else if (lane) {
      const track = lane.dataset.track as Track
      const index = partAt(parts, ms)
      const held = selection?.track === track && selection.indices.includes(index) && !e.shiftKey
      if (!held) onSelect(track, index, e.shiftKey)
      onSeek(ms)
      // Only the parts of the strip are moved by dragging: the other tracks follow them
      if (track === 'screen' && !e.shiftKey) drag.current = { kind: 'part', x: e.clientX, indices: held && selection ? selection.indices : [index], moving: false }
      else drag.current = { kind: 'scrub' }
    } else {
      drag.current = { kind: 'scrub' }
      onSeek(ms)
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const ms = timeAt(e.clientX)
    if (d.kind === 'scrub') onSeek(ms)
    else if (d.kind === 'boundary') onBoundary(d.i, ms)
    else if (d.moving || Math.abs(e.clientX - d.x) > DRAG_PX) {
      d.moving = true
      setInsert(gapAt(ms))
    }
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (d?.kind === 'part' && d.moving && insert) onMove(d.indices, insert.before)
    setInsert(null)
  }

  /** Arrows move a boundary by a frame, with Shift by a second. */
  const onBoundaryKey = (i: number) => (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = { ArrowLeft: -1, ArrowRight: 1 }[e.key]
    if (!delta) return
    e.preventDefault()
    e.stopPropagation()
    onBoundaryStart()
    onBoundary(i, starts[i + 1] + delta * (e.shiftKey ? 1000 : 1000 / media.fps))
  }

  // Only what is in view (and a tile either side) is drawn: zoomed in, a long recording has thousands of tiles
  const viewFrom = pxPerMs ? view.left / pxPerMs : 0
  const viewTo = pxPerMs ? (view.left + view.width) / pxPerMs : duration
  // Thumbnails as wide as their picture: at zoom 1 a whole number of them fills the strip, and each
  // zoom level splits them in halves, so the ones already made are reused
  const thumbPx = clamp((STRIP_PX * media.width) / media.height, 32, 160)
  const baseMs = duration / Math.max(1, Math.round(view.width / thumbPx))
  const tileMs = pxPerMs ? baseMs / 2 ** Math.max(0, Math.round(Math.log2((baseMs * pxPerMs) / thumbPx))) : duration
  const tiles: number[] = []
  for (let i = Math.max(0, Math.floor(viewFrom / tileMs) - 1); i * tileMs < Math.min(duration, viewTo + tileMs); i++) tiles.push(i * tileMs)
  const labelMs = pxPerMs ? step(LABEL_PX / pxPerMs) : duration
  const labels: number[] = []
  for (let ms = Math.floor(viewFrom / labelMs) * labelMs; ms <= Math.min(duration, viewTo); ms += labelMs) labels.push(ms)

  /** The tiles of a part, each with the instant of the recording it shows (where it enters the part). */
  const partTiles = (i: number): { left: number; source: number }[] => {
    const s = starts[i]
    const e = s + parts[i].to - parts[i].from
    return tiles.filter((ms) => ms + tileMs > s && ms < e).map((ms) => ({ left: ms - s, source: Math.round(parts[i].from + Math.max(0, ms - s)) }))
  }
  const wanted = media.video ? parts.flatMap((_, i) => partTiles(i).map((tile) => tile.source)) : []
  const wantedKey = wanted.join(',')
  useEffect(() => {
    for (const ms of wanted) {
      if (thumbs.current.has(ms)) continue
      thumbs.current.set(ms, null)
      window.api.recordings.thumbnail(dir, ms).then(
        (url) => {
          thumbs.current.set(ms, url)
          setThumbsLoaded((n) => n + 1)
        },
        (e: Error) => console.error('thumbnail', dir, ms, e)
      )
    }
  }, [wantedKey])

  const tileImage = (source: number): string | null | undefined => {
    if (media.video) return thumbs.current.get(source)
    const frame = frameAt(media.frames, source)
    return frame && mediaUrl(frame.path)
  }

  /** A part's box on a lane; children are placed in ms of the recording from its start. */
  const partBox = (track: Track | null, i: number, children: ReactNode, extra = '') => {
    const p = parts[i]
    const selected = track && selection?.track === track && selection.indices.includes(i)
    return (
      <div
        key={i}
        className={`timeline-part ${extra}${p.removed ? ' removed' : ''}${selected ? ' selected' : ''}`}
        style={{ left: pct(starts[i], duration), width: pct(p.to - p.from, duration) }}
      >
        {children}
      </div>
    )
  }
  /** Placed inside a part box, in ms of the recording. */
  const inPart = (p: EditPart, from: number, to: number) => ({ left: pct(from - p.from, p.to - p.from), width: pct(to - from, p.to - p.from) })

  const webcam = media.webcam
  const speech = (p: EditPart) => media.transcript.filter((s) => s.start * 1000 < p.to && s.end * 1000 > p.from)

  return (
    <>
      <div className="timeline-toolbar">
        {controls}
        <div className="timeline-zoom">
          <button className="btn ghost icon-btn" aria-label={t('edit.zoomOut')} title={t('edit.zoomOut')} disabled={zoom <= 1} onClick={() => zoomBy(1 / 2)}>
            <Icon name="minus" />
          </button>
          <button className="btn ghost icon-btn" aria-label={t('edit.zoomIn')} title={t('edit.zoomIn')} disabled={zoom >= maxZoom} onClick={() => zoomBy(2)}>
            <Icon name="plus" />
          </button>
        </div>
      </div>
      <div className="timeline-frame">
        <div className="timeline-labels" aria-hidden="true">
          <div className="timeline-label ruler" />
          <div className="timeline-label strip">
            <Icon name="monitor" />
            {media.format === 'jpg' ? t('edit.laneFrames') : t('edit.laneScreen')}
          </div>
          {webcam && (
            <div className="timeline-label webcam">
              <Icon name="webcam" />
              {t('edit.laneWebcam')}
            </div>
          )}
          {media.hasAudio && (
            <div className="timeline-label audio">
              <Icon name="volume" />
              {t('edit.laneAudio')}
            </div>
          )}
          {media.clicks.length > 0 && (
            <div className="timeline-label clicks">
              <Icon name="pointer" />
              {t('edit.laneClicks')}
            </div>
          )}
        </div>
        <div className="timeline" ref={viewport} onScroll={measure}>
          <div
            className="timeline-content"
            ref={content}
            style={{ width: `${zoom * 100}%` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div className="timeline-ruler">
              {labels.map((ms) => (
                <span key={ms} style={{ left: pct(ms, duration) }}>
                  {labelMs >= 1000 ? formatTime(ms).slice(0, -4) : formatTime(ms)}
                </span>
              ))}
            </div>
            <div className="timeline-lanes">
              <div className="timeline-lane strip" data-track="screen" title={media.format === 'jpg' ? t('edit.laneFrames') : t('edit.laneScreen')}>
                {parts.map((p, i) =>
                  partBox(
                    'screen',
                    i,
                    partTiles(i).map(({ left, source }) => {
                      const src = tileImage(source)
                      return (
                        <div key={left} className="timeline-tile" style={{ left: pct(left, p.to - p.from), width: pct(tileMs, p.to - p.from) }}>
                          {src && <img src={src} alt="" draggable={false} />}
                        </div>
                      )
                    })
                  )
                )}
              </div>
              {webcam && (
                <div className="timeline-lane webcam" data-track="webcam" title={t('edit.laneWebcam')}>
                  {parts.map((p, i) =>
                    partBox(
                      'webcam',
                      i,
                      layoutRuns(p, webcam.layout).map((run) => (
                        <span key={run.from} className={`${run.layout.visible ? 'on' : 'off'}${run.own ? ' own' : ''}`} style={inPart(p, run.from, run.to)} title={layoutLabel(run.layout)}>
                          <Icon name={run.layout.visible ? 'webcam' : 'webcam-off'} />
                        </span>
                      ))
                    )
                  )}
                </div>
              )}
              {media.hasAudio && (
                <div className="timeline-lane audio" data-track="audio" title={t('edit.laneAudio')}>
                  {parts.map((p, i) =>
                    partBox(
                      'audio',
                      i,
                      <>
                        {media.muted
                          .filter((m) => m.fromMs < p.to && m.toMs > p.from)
                          .map((m) => (
                            <span key={`m${m.fromMs}`} className="silence" style={inPart(p, Math.max(m.fromMs, p.from), Math.min(m.toMs, p.to))} title={t('edit.mutedBefore')} />
                          ))}
                        {speech(p).map((s, k) => (
                          <span
                            key={k}
                            className="phrase"
                            style={inPart(p, Math.max(s.start * 1000, p.from), Math.min(s.end * 1000, p.to))}
                            title={`${formatTime(s.start * 1000)} → ${formatTime(s.end * 1000)}  ${s.text}`}
                          >
                            {s.text}
                          </span>
                        ))}
                      </>,
                      p.muted ? 'muted' : ''
                    )
                  )}
                </div>
              )}
              {media.clicks.length > 0 && (
                <div className="timeline-lane clicks" title={t('edit.laneClicks')}>
                  {parts.map((p, i) =>
                    partBox(
                      null,
                      i,
                      media.clicks
                        .filter((c) => c.t >= p.from && c.t < p.to)
                        .map((c, k) => <span key={k} style={{ left: pct(c.t - p.from, p.to - p.from) }} title={t('edit.click', { time: formatTime(c.t) })} />)
                    )
                  )}
                </div>
              )}
              {parts.map((p, i) => p.removed && <div key={i} className="timeline-cut" style={{ left: pct(starts[i], duration), width: pct(p.to - p.from, duration) }} title={t('edit.removed')} />)}
              {parts.slice(1).map((p, k) => (
                <div key={k} className={`timeline-boundary${parts[k].to === p.from ? '' : ' join'}`} style={{ left: pct(starts[k + 1], duration) }} />
              ))}
              {parts.slice(1).map(
                (_, k) =>
                  canMoveBoundary(parts, k) && (
                    <div
                      key={k}
                      className="timeline-grip"
                      style={{ left: pct(starts[k + 1], duration) }}
                      data-boundary={k}
                      role="slider"
                      tabIndex={0}
                      aria-label={t('edit.boundary')}
                      aria-valuemin={0}
                      aria-valuemax={duration}
                      aria-valuenow={Math.round(starts[k + 1])}
                      aria-valuetext={formatTime(starts[k + 1])}
                      onKeyDown={onBoundaryKey(k)}
                    />
                  )
              )}
            </div>
            {insert && <div className="timeline-insert" style={{ left: pct(insert.ms, duration) }} />}
            <div className="timeline-playhead" style={{ left: pct(time, duration) }} />
          </div>
        </div>
      </div>
    </>
  )
}
