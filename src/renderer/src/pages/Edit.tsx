import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  canJoin,
  isEdited,
  joinParts,
  keptDuration,
  MIN_RESULT_MS,
  moveBoundary,
  moveParts,
  partAt,
  partStarts,
  snapToFrame,
  splitAt,
  toSource,
  updateParts,
  wholeRecording,
  type EditPart
} from '../../../shared/edit-list'
import { t } from '../../../shared/i18n'
import { mediaUrl } from '../../../shared/media-url'
import { formatTime } from '../../../shared/time'
import type { RecordingMedia } from '../../../shared/types'
import { webcamRadius, webcamRect, type WebcamCorner, type WebcamLayout, type WebcamShape } from '../../../shared/webcam'
import { EditTimeline, frameAt, layoutRuns, type Selection, type Track } from '../components/EditTimeline'
import { Icon } from '../components/Icon'
import { Segmented } from '../components/Segmented'
import { TimeField } from '../components/TimeField'
import { CornerPicker, shapeOptions } from '../components/WebcamPicker'

interface Props {
  dir: string
  /** Title or date, as the recent list shows it */
  name: string
  onClose: () => void
}

/** Edits a past recording; saving hands the edit list to the main process, which reports progress as state. */
export function EditView({ dir, name, onClose }: Props) {
  const [media, setMedia] = useState<RecordingMedia | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    window.api.recordings.media(dir).then(setMedia, (e: Error) => {
      console.error('cannot read the recording to edit', dir, e)
      setError(e.message)
    })
  }, [dir])

  return (
    <>
      <div className="page-header">
        <h1>{t('edit.title')}</h1>
        <p>{name}</p>
      </div>
      {media ? (
        <Editor dir={dir} media={media} onClose={onClose} />
      ) : (
        <div className="card">
          {error ? (
            <div className="notice error">
              <Icon name="alert" />
              <span>{t('edit.loadFailed', { error })}</span>
            </div>
          ) : (
            <span className="spinner" />
          )}
          <div className="row mt-4">
            <button className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

interface History {
  past: EditPart[][]
  present: EditPart[]
  future: EditPart[][]
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => from + k)
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
/** The first part after `i` that is kept, or -1. */
const nextKept = (parts: EditPart[], i: number) => parts.findIndex((p, k) => k > i && !p.removed)

/**
 * The player, the timeline and the actions. The clock is the video (the screen, with the webcam
 * shown over it as the edit will lay it), or for a JPG recording its audio, shown with the frame
 * on screen at each instant; a JPG recording without audio gets a clock of its own. Playing goes
 * through the parts in their order and skips those cut out.
 */
function Editor({ dir, media, onClose }: { dir: string; media: RecordingMedia; onClose: () => void }) {
  const duration = media.durationMs
  const snap = (ms: number) => (media.format === 'jpg' ? ms : snapToFrame(ms, media.fps))
  const [history, setHistory] = useState<History>({ past: [], present: wholeRecording(duration), future: [] })
  const parts = history.present
  const partsRef = useRef(parts)
  partsRef.current = parts
  const [selection, setSelection] = useState<Selection | null>(null)
  // The parts before a boundary is dragged: the whole drag is one step to undo
  const dragBase = useRef<EditPart[] | null>(null)

  const player = useRef<HTMLMediaElement | null>(null)
  const follower = useRef<HTMLVideoElement | null>(null)
  const timeRef = useRef(0)
  // The part playing: its end decides where to go next
  const playingPart = useRef(0)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [cannotPlay, setCannotPlay] = useState(false)

  const commit = (next: EditPart[] | null, select?: Selection | null) => {
    if (!next || next === parts) return
    setHistory((h) => ({ past: [...h.past, h.present], present: next, future: [] }))
    if (select !== undefined) setSelection(select)
  }
  const undo = () => {
    setHistory((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h))
    setSelection(null)
  }
  const redo = () => {
    setHistory((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h))
    setSelection(null)
  }

  // ---- the webcam over the screen ----------------------------------------------------

  const webcam = media.webcam
  const editing = webcam?.editing ?? 'none'
  /** The instant of the webcam's own track for an instant of the recording; null before it started. */
  const trackTime = (src: number): number | null => {
    const track = webcam?.track
    if (!track) return null
    let at = 0
    for (const r of track.kept) {
      const len = r.toMs - r.fromMs
      if (src < at + len || r === track.kept[track.kept.length - 1]) {
        const t = r.fromMs + src - at - track.offsetMs
        return t >= 0 ? t : null
      }
      at += len
    }
    return null
  }
  /** Where the overlay's video should be for an instant of the recording, in seconds. */
  const followerTime = (src: number): number | null => {
    if (editing === 'full') {
      const t = trackTime(src)
      return t === null ? null : t / 1000
    }
    return editing === 'hide' ? src / 1000 : null
  }
  const follow = (src: number, hard: boolean) => {
    const f = follower.current
    const target = followerTime(src)
    if (!f || target === null) return
    if (hard || Math.abs(f.currentTime - target) > 0.15) f.currentTime = target
  }

  // ---- playing -----------------------------------------------------------------------

  const show = (ms: number) => {
    timeRef.current = ms
    setTime(ms)
  }
  const seek = (ms: number) => {
    const v = clamp(ms, 0, duration)
    playingPart.current = partAt(parts, v)
    const src = toSource(parts, v)
    if (player.current) player.current.currentTime = src / 1000
    follow(src, true)
    show(v)
  }

  // timeupdate fires a few times a second: while playing, the time follows every frame
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const ps = partsRef.current
      const starts = partStarts(ps)
      const el = player.current
      if (el) {
        let i = Math.min(playingPart.current, ps.length - 1)
        let src = el.currentTime * 1000
        if (src >= ps[i].to - 1 || ps[i].removed) {
          const next = nextKept(ps, i)
          if (next < 0) {
            el.pause()
            show(starts[i] + ps[i].to - ps[i].from)
            return
          }
          // Not where the recording goes on by itself: jump
          if (ps[next].from !== ps[i].to || ps[i].removed) {
            el.currentTime = ps[next].from / 1000
            src = ps[next].from
            follow(src, true)
          }
          i = playingPart.current = next
        }
        el.muted = !!ps[i].muted
        follow(src, false)
        show(starts[i] + clamp(src - ps[i].from, 0, ps[i].to - ps[i].from))
      } else {
        let ms = timeRef.current + (now - last)
        const i = partAt(ps, ms)
        if (ps[i].removed) {
          const next = nextKept(ps, i)
          ms = next < 0 ? duration : starts[next]
        }
        if (ms >= duration) {
          show(duration)
          setPlaying(false)
          return
        }
        show(ms)
      }
      last = now
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const toggle = () => {
    const el = player.current
    if (playing) {
      if (el) el.pause()
      else setPlaying(false)
      return
    }
    // From the playhead, or from the start at the end; never inside a part cut out
    let ms = timeRef.current >= duration - 1 ? 0 : timeRef.current
    const i = partAt(parts, ms)
    if (parts[i].removed) {
      const next = nextKept(parts, i)
      const first = nextKept(parts, -1)
      if (first < 0) return
      ms = partStarts(parts)[next < 0 ? first : next]
    }
    seek(ms)
    if (el) el.play().catch((e: Error) => console.error('cannot play', dir, e))
    else setPlaying(true)
  }

  const bindPlayer = (el: HTMLMediaElement | null) => {
    player.current = el
  }
  const playerEvents = {
    onPlay: () => {
      setPlaying(true)
      void follower.current?.play().catch(() => {})
    },
    onPause: () => {
      setPlaying(false)
      follower.current?.pause()
    },
    onError: () => setCannotPlay(true)
  }

  // ---- editing -----------------------------------------------------------------------

  const select = (track: Track, index: number, extend: boolean) =>
    setSelection((sel) =>
      extend && sel && sel.track === track
        ? { track, anchor: sel.anchor, indices: range(Math.min(sel.anchor, index), Math.max(sel.anchor, index)) }
        : { track, anchor: index, indices: [index] }
    )
  const chosen = selection ? selection.indices.map((i) => parts[i]).filter(Boolean) : []

  const split = () => {
    const i = partAt(parts, time)
    commit(splitAt(parts, time, snap), { track: selection?.track ?? 'screen', anchor: i + 1, indices: [i + 1] })
  }
  const join = () => {
    if (!selection || !canJoin(parts, selection.indices)) return
    const first = selection.indices[0]
    commit(joinParts(parts, selection.indices), { ...selection, anchor: first, indices: [first] })
  }
  const move = (indices: number[], before: number) => {
    const moved = moveParts(parts, indices, before)
    if (moved.parts.every((p, i) => p === parts[i])) return
    commit(moved.parts, { track: 'screen', anchor: moved.indices[0], indices: moved.indices })
  }
  const moveBy = (delta: -1 | 1) => {
    if (!selection) return
    const { indices } = selection
    const before = delta < 0 ? indices[0] - 1 : indices[indices.length - 1] + 2
    if (before < 0 || before > parts.length) return
    move(indices, before)
  }
  const onBoundaryStart = () => {
    dragBase.current = parts
  }
  const onBoundary = (i: number, ms: number) => {
    const next = moveBoundary(parts, i, ms, snap)
    if (!next) return
    const base = dragBase.current
    dragBase.current = null
    setHistory((h) => (base ? { past: [...h.past, base], present: next, future: [] } : { ...h, present: next }))
    seek(partStarts(next)[i + 1])
  }

  const allRemoved = chosen.length > 0 && chosen.every((p) => p.removed)
  const allMuted = chosen.length > 0 && chosen.every((p) => p.muted)
  /** The webcam over a part where it starts: its own layout, or the recorded one. */
  const layoutOf = (p: EditPart): WebcamLayout => layoutRuns(p, webcam?.layout ?? [])[0].layout
  const allHidden = chosen.length > 0 && chosen.every((p) => p.webcam && !p.webcam.visible)
  const setWebcam = (layout: WebcamLayout | undefined) => selection && commit(updateParts(parts, selection.indices, { webcam: layout }))

  /** What Backspace does on the track selected. */
  const primary = () => {
    if (!selection) return
    const { track, indices } = selection
    if (track === 'screen') commit(updateParts(parts, indices, { removed: !allRemoved }))
    else if (track === 'audio') commit(updateParts(parts, indices, { muted: !allMuted }))
    else if (editing !== 'none') setWebcam(allHidden ? undefined : { ...layoutOf(chosen[0]), visible: false })
  }

  // ---- keys --------------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select')) return
      const mod = e.metaKey || e.ctrlKey
      if (e.key === ' ') {
        e.preventDefault()
        if (e.type === 'keydown' && !e.repeat) toggle()
        return
      }
      // A focused button would take Space on keyup: the editor's keys act on the editor
      if (e.type !== 'keydown') return
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (mod) return
      else if (e.key === 's' || e.key === 'S') split()
      else if (e.key === 'j' || e.key === 'J') join()
      else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        primary()
      } else if (e.key === 'Escape') setSelection(null)
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const delta = e.key === 'ArrowLeft' ? -1 : 1
        if (e.altKey) moveBy(delta)
        else seek(timeRef.current + delta * (e.shiftKey ? 1000 : 1000 / media.fps))
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  })

  // ---- the stage ---------------------------------------------------------------------

  // The picture fills the stage keeping its proportions; the webcam is placed in % of it
  const stage = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const fit = () => {
      const aspect = media.width / media.height
      const width = Math.min(el.clientWidth, el.clientHeight * aspect)
      setBox({ width, height: width / aspect })
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const here = partAt(parts, time)
  const src = toSource(parts, time)
  const frame = media.frames.length ? frameAt(media.frames, src) : undefined
  const recordedNow = webcam ? (webcam.layout.filter((e) => e.t <= src).pop() ?? webcam.layout[0]) : undefined
  const effective = webcam ? (parts[here].webcam ?? recordedNow) : undefined
  const area = (r: { x: number; y: number; width: number; height: number }) => ({
    left: `${(r.x / media.width) * 100}%`,
    top: `${(r.y / media.height) * 100}%`,
    width: `${(r.width / media.width) * 100}%`,
    height: `${(r.height / media.height) * 100}%`
  })
  let overlay: { style: ReturnType<typeof area>; radius: string } | null = null
  if (editing === 'full' && effective?.visible && trackTime(src) !== null) {
    const r = webcamRect(effective.shape, effective.corner, media.width, media.height)
    const radius = webcamRadius(effective.shape, r.height)
    overlay = { style: area(r), radius: `${(radius / r.width) * 100}% / ${(radius / r.height) * 100}%` }
  } else if (editing === 'hide' && recordedNow?.visible && effective?.visible) overlay = { style: area(recordedNow.rect), radius: '0' }

  // ---- what the editor shows -----------------------------------------------------------

  const kept = keptDuration(parts)
  const valid = kept >= MIN_RESULT_MS
  const changed = isEdited(parts)
  const save = () => {
    player.current?.pause()
    void window.api.recordings.edit(dir, parts)
    onClose()
  }
  const cancel = () => {
    if (changed && !confirm(t('edit.confirmDiscard'))) return
    onClose()
  }

  const track = selection?.track
  const summary =
    chosen.length === 1
      ? t('edit.partRange', { from: formatTime(chosen[0].from), to: formatTime(chosen[0].to) })
      : chosen.length > 1
        ? t('edit.partsSelected', { n: chosen.length, duration: formatTime(chosen.reduce((sum, p) => sum + p.to - p.from, 0)) })
        : t('edit.noSelection')
  const firstLayout = chosen.length && webcam ? layoutOf(chosen[0]) : null

  return (
    <div className="card">
      <div className="edit-stage" ref={stage}>
        <div className="edit-screen" style={{ width: box.width, height: box.height }}>
          {media.video ? (
            <video ref={bindPlayer} src={mediaUrl(media.video)} preload="auto" onClick={toggle} {...playerEvents} />
          ) : (
            frame && <img src={mediaUrl(frame.path)} alt="" />
          )}
          {media.audio && <audio ref={bindPlayer} src={mediaUrl(media.audio)} preload="auto" {...playerEvents} />}
          {webcam && editing !== 'none' && (
            <div className={`edit-webcam ${editing}`} style={{ ...(overlay?.style ?? {}), borderRadius: overlay?.radius, visibility: overlay ? 'visible' : 'hidden' }}>
              {editing === 'full' && webcam.track && <video ref={follower} src={mediaUrl(webcam.track.path)} muted preload="auto" />}
              {editing === 'hide' && recordedNow && (
                <video
                  ref={follower}
                  src={mediaUrl(webcam.composite)}
                  muted
                  preload="auto"
                  style={{
                    width: `${(media.width / recordedNow.rect.width) * 100}%`,
                    height: `${(media.height / recordedNow.rect.height) * 100}%`,
                    left: `${-(recordedNow.rect.x / recordedNow.rect.width) * 100}%`,
                    top: `${-(recordedNow.rect.y / recordedNow.rect.height) * 100}%`
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
      {cannotPlay && (
        <div className="notice warn">
          <Icon name="alert" />
          <span>{t('edit.cannotPlay')}</span>
        </div>
      )}

      <EditTimeline
        dir={dir}
        media={media}
        parts={parts}
        selection={selection}
        time={time}
        playing={playing}
        onSeek={seek}
        onSelect={select}
        onMove={move}
        onBoundaryStart={onBoundaryStart}
        onBoundary={onBoundary}
        controls={
          <>
            <button className="btn icon-btn" aria-label={playing ? t('edit.pause') : t('edit.play')} title={`${playing ? t('edit.pause') : t('edit.play')} (Space)`} onClick={toggle}>
              <Icon name={playing ? 'pause' : 'play'} />
            </button>
            <TimeField label={t('edit.playhead')} value={Math.round(time)} max={duration} onChange={seek} />
            <span className="mono edit-total">/ {formatTime(duration)}</span>
            <div className="edit-history">
              <button className="btn ghost icon-btn" aria-label={t('edit.undo')} title={`${t('edit.undo')} (⌘Z)`} disabled={!history.past.length} onClick={undo}>
                <Icon name="undo" />
              </button>
              <button className="btn ghost icon-btn" aria-label={t('edit.redo')} title={`${t('edit.redo')} (⇧⌘Z)`} disabled={!history.future.length} onClick={redo}>
                <Icon name="redo" />
              </button>
            </div>
          </>
        }
      />

      <div className="edit-actions">
        <button className="btn sm" title={`${t('edit.splitHint')} (S)`} onClick={split}>
          <Icon name="scissors" />
          {t('edit.split')}
        </button>
        <button className="btn sm" title={`${t('edit.joinHint')} (J)`} disabled={!selection || !canJoin(parts, selection.indices)} onClick={join}>
          <Icon name="link" />
          {t('edit.join')}
        </button>
        {track === 'screen' && (
          <button className="btn sm" title="⌫" onClick={primary}>
            {allRemoved ? t('edit.restore') : t('edit.remove')}
          </button>
        )}
        {track === 'audio' && (
          <button className="btn sm" title="⌫" onClick={primary}>
            <Icon name={allMuted ? 'volume' : 'volume-off'} />
            {allMuted ? t('edit.unmute') : t('edit.mute')}
          </button>
        )}
        {track === 'webcam' && editing !== 'none' && firstLayout && (
          <>
            <button
              className="btn sm"
              title="⌫"
              // Without its own track, the webcam comes back only where it was recorded
              disabled={editing === 'hide' && !firstLayout.visible && !chosen[0].webcam}
              onClick={() => setWebcam(firstLayout.visible ? { ...firstLayout, visible: false } : editing === 'full' ? { ...firstLayout, visible: true } : undefined)}
            >
              <Icon name={firstLayout.visible ? 'webcam-off' : 'webcam'} />
              {firstLayout.visible ? t('edit.hideWebcam') : t('edit.showWebcam')}
            </button>
            <button className="btn sm ghost" disabled={!chosen.some((p) => p.webcam)} onClick={() => setWebcam(undefined)}>
              {t('edit.asRecorded')}
            </button>
          </>
        )}
        <span className="small dim edit-summary">{summary}</span>
      </div>
      {track === 'webcam' && editing === 'full' && firstLayout && (
        <div className="edit-webcam-layout">
          <Segmented options={shapeOptions()} value={firstLayout.shape} onChange={(shape: WebcamShape) => setWebcam({ shape, corner: firstLayout.corner, visible: true })} />
          <CornerPicker shape={firstLayout.shape} corner={firstLayout.corner} onChange={(corner: WebcamCorner) => setWebcam({ shape: firstLayout.shape, corner, visible: true })} />
        </div>
      )}
      {track === 'webcam' && editing !== 'full' && <p className="small dim mt-2">{editing === 'hide' ? t('edit.webcamHideOnly') : t('edit.webcamNone')}</p>}

      <p className="small dim mt-3">{t('edit.timelineHint')}</p>
      <p className="small dim mt-2">{media.edited ? t('edit.hintEdited') : t('edit.hint')}</p>
      <div className="row mt-3">
        <button className="btn primary" disabled={!valid || !changed} onClick={save}>
          {t('common.save')}
        </button>
        <button className="btn" onClick={cancel}>
          {t('common.cancel')}
        </button>
        <span className={valid ? 'dim' : 'text-warn'}>{valid ? t('edit.result', { duration: formatTime(kept), total: formatTime(duration) }) : t('edit.tooShort')}</span>
      </div>
    </div>
  )
}
