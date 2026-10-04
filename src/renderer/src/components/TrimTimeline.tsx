import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { t } from '../../../shared/i18n'
import { mediaUrl } from '../../../shared/media-url'
import { formatTime, MIN_TRIM_MS } from '../../../shared/time'
import type { RecordingMedia } from '../../../shared/types'
import { Icon } from './Icon'

interface Props {
  dir: string
  media: RecordingMedia
  /** Playhead, ms */
  time: number
  start: number
  end: number
  playing: boolean
  onSeek: (ms: number) => void
  onStart: (ms: number) => void
  onEnd: (ms: number) => void
  /** Shown left of the zoom buttons, above the timeline (play button, time) */
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

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const pct = (ms: number, duration: number) => `${(ms / duration) * 100}%`

/** The frame on screen at `ms`: the last one taken at or before it. */
export function frameAt(frames: RecordingMedia['frames'], ms: number): RecordingMedia['frames'][number] | undefined {
  let found = frames[0]
  for (const f of frames) {
    if (f.tMs > ms) break
    found = f
  }
  return found
}

/**
 * The recording on one axis: a strip of thumbnails, the transcript phrases and the clicks, with the
 * playhead and the two ends of the part kept. Dragging the strip moves the playhead, dragging an
 * end moves it (and shows its frame); pinch or ⌘ + wheel zooms, a horizontal swipe scrolls.
 */
export function TrimTimeline({ dir, media, time, start, end, playing, onSeek, onStart, onEnd, controls }: Props) {
  const duration = media.durationMs
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  // For the wheel listener, registered once
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const [view, setView] = useState({ left: 0, width: 0 })
  const anchor = useRef<{ ms: number; x: number } | null>(null)
  const drag = useRef<'seek' | 'start' | 'end' | null>(null)
  const thumbs = useRef(new Map<number, string | null>())
  const [, setThumbsLoaded] = useState(0)

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
  const moveTo = (clientX: number) => {
    const ms = timeAt(clientX)
    if (drag.current === 'start') {
      const v = Math.round(clamp(ms, 0, end - MIN_TRIM_MS))
      onStart(v)
      onSeek(v)
    } else if (drag.current === 'end') {
      const v = Math.round(clamp(ms, start + MIN_TRIM_MS, duration))
      onEnd(v)
      onSeek(v)
    } else onSeek(ms)
  }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const handle = (e.target as HTMLElement).dataset.handle
    drag.current = handle === 'start' || handle === 'end' ? handle : 'seek'
    e.currentTarget.setPointerCapture(e.pointerId)
    moveTo(e.clientX)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) moveTo(e.clientX)
  }
  const onPointerUp = () => {
    drag.current = null
  }

  /** Arrows move an end by a frame, with Shift by a second. */
  const onHandleKey = (which: 'start' | 'end') => (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = { ArrowLeft: -1, ArrowRight: 1 }[e.key]
    if (!delta) return
    e.preventDefault()
    const by = delta * (e.shiftKey ? 1000 : 1000 / media.fps)
    if (which === 'start') {
      const v = Math.round(clamp(start + by, 0, end - MIN_TRIM_MS))
      onStart(v)
      onSeek(v)
    } else {
      const v = Math.round(clamp(end + by, start + MIN_TRIM_MS, duration))
      onEnd(v)
      onSeek(v)
    }
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
  for (let i = Math.max(0, Math.floor(viewFrom / tileMs) - 1); i * tileMs < Math.min(duration, viewTo + tileMs); i++) tiles.push(Math.round(i * tileMs))
  const labelMs = pxPerMs ? step(LABEL_PX / pxPerMs) : duration
  const labels: number[] = []
  for (let ms = Math.floor(viewFrom / labelMs) * labelMs; ms <= Math.min(duration, viewTo); ms += labelMs) labels.push(ms)

  const tilesKey = media.video ? tiles.join(',') : ''
  useEffect(() => {
    if (!media.video) return
    for (const ms of tiles) {
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
  }, [tilesKey])

  const tileImage = (ms: number): string | null | undefined => {
    if (media.video) return thumbs.current.get(ms)
    const frame = frameAt(media.frames, ms)
    return frame && mediaUrl(frame.path)
  }

  const handle = (which: 'start' | 'end', ms: number) => (
    <div
      className={`timeline-handle ${which}`}
      style={{ left: pct(ms, duration) }}
      data-handle={which}
      role="slider"
      tabIndex={0}
      aria-label={which === 'start' ? t('trim.start') : t('trim.end')}
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={ms}
      aria-valuetext={formatTime(ms)}
      onKeyDown={onHandleKey(which)}
    />
  )

  return (
    <>
      <div className="timeline-toolbar">
        {controls}
        <div className="timeline-zoom">
          <button className="btn ghost icon-btn" aria-label={t('trim.zoomOut')} title={t('trim.zoomOut')} disabled={zoom <= 1} onClick={() => zoomBy(1 / 2)}>
            <Icon name="minus" />
          </button>
          <button className="btn ghost icon-btn" aria-label={t('trim.zoomIn')} title={t('trim.zoomIn')} disabled={zoom >= maxZoom} onClick={() => zoomBy(2)}>
            <Icon name="plus" />
          </button>
        </div>
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
            <div className="timeline-strip">
              {tiles.map((ms) => {
                const src = tileImage(ms)
                return (
                  <div key={ms} className="timeline-tile" style={{ left: pct(ms, duration), width: pct(tileMs, duration) }}>
                    {src && <img src={src} alt="" draggable={false} />}
                  </div>
                )
              })}
            </div>
            {media.transcript.length > 0 && (
              <div className="timeline-lane speech" title={t('trim.laneSpeech')}>
                {media.transcript.map((s, i) => (
                  <span
                    key={i}
                    style={{ left: pct(s.start * 1000, duration), width: pct((s.end - s.start) * 1000, duration) }}
                    title={`${formatTime(s.start * 1000)} → ${formatTime(s.end * 1000)}  ${s.text}`}
                  >
                    {s.text}
                  </span>
                ))}
              </div>
            )}
            {media.clicks.length > 0 && (
              <div className="timeline-lane clicks" title={t('trim.laneClicks')}>
                {media.clicks.map((c, i) => (
                  <span key={i} style={{ left: pct(c.t, duration) }} title={t('trim.click', { time: formatTime(c.t) })} />
                ))}
              </div>
            )}
            <div className="timeline-cut" style={{ left: 0, width: pct(start, duration) }} />
            <div className="timeline-cut" style={{ left: pct(end, duration), right: 0 }} />
            <div className="timeline-keep" style={{ left: pct(start, duration), width: pct(end - start, duration) }} />
            {handle('start', start)}
            {handle('end', end)}
          </div>
          <div className="timeline-playhead" style={{ left: pct(time, duration) }} />
        </div>
      </div>
      <p className="small dim mt-2">{t('trim.timelineHint')}</p>
    </>
  )
}
