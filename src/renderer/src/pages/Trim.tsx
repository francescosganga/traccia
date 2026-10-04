import { useEffect, useRef, useState } from 'react'
import { t } from '../../../shared/i18n'
import { mediaUrl } from '../../../shared/media-url'
import { formatTime, MIN_TRIM_MS } from '../../../shared/time'
import type { RecordingMedia } from '../../../shared/types'
import { Icon } from '../components/Icon'
import { TimeField } from '../components/TimeField'
import { frameAt, TrimTimeline } from '../components/TrimTimeline'

interface Props {
  dir: string
  /** Title or date, as the recent list shows it */
  name: string
  onClose: () => void
}

/** Picks the part of a recording to keep; saving hands it to the main process, which reports progress as state. */
export function TrimView({ dir, name, onClose }: Props) {
  const [media, setMedia] = useState<RecordingMedia | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    window.api.recordings.media(dir).then(setMedia, (e: Error) => {
      console.error('cannot read the recording to trim', dir, e)
      setError(e.message)
    })
  }, [dir])

  return (
    <>
      <div className="page-header">
        <h1>{t('trim.title')}</h1>
        <p>{name}</p>
      </div>
      {media ? (
        <Trimmer dir={dir} media={media} onClose={onClose} />
      ) : (
        <div className="card">
          {error ? (
            <div className="notice error">
              <Icon name="alert" />
              <span>{t('trim.loadFailed', { error })}</span>
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

/**
 * The player and the two ends. The clock is the video, or for a JPG recording its audio, shown
 * with the frame on screen at each instant; a JPG recording without audio gets a clock of its own.
 */
function Trimmer({ dir, media, onClose }: { dir: string; media: RecordingMedia; onClose: () => void }) {
  const duration = media.durationMs
  const player = useRef<HTMLMediaElement | null>(null)
  const timeRef = useRef(0)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [cannotPlay, setCannotPlay] = useState(false)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(duration)

  const show = (ms: number) => {
    timeRef.current = ms
    setTime(ms)
  }
  const seek = (ms: number) => {
    const v = Math.max(0, Math.min(duration, ms))
    if (player.current) player.current.currentTime = v / 1000
    show(v)
  }

  // timeupdate fires a few times a second: while playing, the time follows every frame
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      if (player.current) show(Math.min(duration, player.current.currentTime * 1000))
      else {
        const next = timeRef.current + (now - last)
        if (next >= duration) {
          show(duration)
          setPlaying(false)
          return
        }
        show(next)
      }
      last = now
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const toggle = () => {
    const el = player.current
    if (!el) {
      if (!playing && timeRef.current >= duration) show(0)
      setPlaying(!playing)
    } else if (el.paused) {
      if (timeRef.current >= duration) seek(0)
      el.play().catch((e: Error) => console.error('cannot play', dir, e))
    } else el.pause()
  }

  const bindPlayer = (el: HTMLMediaElement | null) => {
    player.current = el
  }
  const playerEvents = {
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onSeeked: (e: { currentTarget: HTMLMediaElement }) => show(Math.min(duration, e.currentTarget.currentTime * 1000)),
    onError: () => setCannotPlay(true)
  }

  const save = () => {
    player.current?.pause()
    void window.api.recordings.trim(dir, start, end)
    onClose()
  }

  const kept = end - start
  const valid = kept >= MIN_TRIM_MS
  const changed = start > 0 || end < duration
  const frame = media.frames.length ? frameAt(media.frames, time) : undefined

  return (
    <div className="card">
      <div className="trim-stage">
        {media.video ? (
          <video ref={bindPlayer} src={mediaUrl(media.video)} preload="auto" onClick={toggle} {...playerEvents} />
        ) : (
          frame && <img src={mediaUrl(frame.path)} alt="" />
        )}
        {media.audio && <audio ref={bindPlayer} src={mediaUrl(media.audio)} preload="auto" {...playerEvents} />}
      </div>
      {cannotPlay && (
        <div className="notice warn">
          <Icon name="alert" />
          <span>{t('trim.cannotPlay')}</span>
        </div>
      )}
      <TrimTimeline
        dir={dir}
        media={media}
        time={time}
        start={start}
        end={end}
        playing={playing}
        onSeek={seek}
        onStart={setStart}
        onEnd={setEnd}
        controls={
          <>
            <button className="btn icon-btn" aria-label={playing ? t('trim.pause') : t('trim.play')} onClick={toggle}>
              <Icon name={playing ? 'pause' : 'play'} />
            </button>
            <span className="mono trim-time">
              {formatTime(time)} / {formatTime(duration)}
            </span>
          </>
        }
      />

      <div className="grid-2 mt-4">
        <div className="field">
          <label>{t('trim.start')}</label>
          <div className="row">
            <TimeField
              label={t('trim.start')}
              value={start}
              max={duration}
              onChange={(v) => {
                setStart(v)
                seek(v)
              }}
            />
            <button className="btn" onClick={() => setStart(Math.round(time))}>
              {t('trim.startHere')}
            </button>
          </div>
        </div>
        <div className="field">
          <label>{t('trim.end')}</label>
          <div className="row">
            <TimeField
              label={t('trim.end')}
              value={end}
              max={duration}
              onChange={(v) => {
                setEnd(v)
                seek(v)
              }}
            />
            <button className="btn" onClick={() => setEnd(Math.round(time))}>
              {t('trim.endHere')}
            </button>
          </div>
        </div>
      </div>

      <p className="small dim mt-3">{media.trimmed ? t('trim.hintTrimmed') : t('trim.hint')}</p>
      <div className="row mt-3">
        <button className="btn primary" disabled={!valid || !changed} onClick={save}>
          {t('common.save')}
        </button>
        <button className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <span className={valid ? 'dim' : 'text-warn'}>
          {valid ? t('trim.duration', { duration: formatTime(kept), total: formatTime(duration) }) : t('trim.tooShort')}
        </span>
      </div>
    </div>
  )
}
