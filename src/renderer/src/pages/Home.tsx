import { useEffect, useState } from 'react'
import { t } from '../../../shared/i18n'
import type { AppState, CaptureMode, DisplayInfo, RecordingEntry, Settings } from '../../../shared/types'
import { Icon } from '../components/Icon'
import { formatDate, formatDuration, formatShortcut } from '../format'
import { FORMATS, JPG_FPS, RESOLUTIONS, resolutionLabel } from '../options'

interface Props {
  settings: Settings
  update: (patch: Partial<Settings>) => Promise<void>
  state: AppState
  modelInstalled: boolean
  platform: string
  goSettings: () => void
}

export function Home({ settings, update, state, modelInstalled, platform, goSettings }: Props) {
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [recordings, setRecordings] = useState<RecordingEntry[]>([])
  const [mode, setMode] = useState<CaptureMode>(settings.lastMode)
  const [displayId, setDisplayId] = useState<number | undefined>(settings.lastDisplayId ?? undefined)

  const refreshRecordings = () => void window.api.recordings.list().then(setRecordings)

  useEffect(() => {
    void window.api.system.displays().then((d) => {
      setDisplays(d)
      if (!d.some((x) => x.id === displayId)) setDisplayId(d.find((x) => x.primary)?.id ?? d[0]?.id)
    })
    refreshRecordings()
  }, [])
  useEffect(() => {
    if (state.status === 'done') refreshRecordings()
  }, [state.status])

  const start = () => void window.api.recording.start({ mode, displayId })
  const reveal = platform === 'darwin' ? t('home.revealMac') : t('home.revealOther')
  const busy = state.status === 'processing' || state.status === 'recording' || state.status === 'countdown' || state.status === 'selecting'
  const shortcut = settings.shortcutsEnabled ? formatShortcut(mode === 'region' ? settings.shortcutRegion : settings.shortcutScreen, platform) : null
  const dismiss = (
    <button className="btn ghost icon-btn" aria-label={t('common.cancel')} onClick={() => window.api.recording.reset()}>
      <Icon name="x" />
    </button>
  )

  return (
    <div className="content">
      <div className="content-inner">
        <div className="page-header">
          <h1>{t('home.title')}</h1>
        </div>

        {state.status === 'processing' && (
          <div className="card info">
            <div className="title-row">
              <span className="spinner" />
              <h2>{t('home.processing')}</h2>
            </div>
            <p className="dim mt-2">
              {state.step}
              {state.detail ? ` — ${state.detail}` : ''}
            </p>
            <div className={`progress ${state.progress < 0 ? 'indeterminate' : ''}`}>
              <div style={{ width: `${Math.round(Math.max(0, state.progress) * 100)}%` }} />
            </div>
          </div>
        )}

        {state.status === 'done' && (
          <div className="card success">
            <div className="title-row">
              <span className="status-icon ok">
                <Icon name="check" />
              </span>
              <h2>{t('home.done')}</h2>
              {dismiss}
            </div>
            <p className="dim mt-2">
              {formatDuration(state.result.durationMs)} · {state.result.width}×{state.result.height} · {state.result.format.toUpperCase()}
              {state.result.frames !== undefined &&
                ` · ${t('home.frames', { n: state.result.frames })}${state.result.skippedFrames ? ' ' + t('home.skipped', { n: state.result.skippedFrames }) : ''}`}
              {state.result.transcriptSegments !== undefined && ` · ${t('home.segments', { n: state.result.transcriptSegments })}`}
            </p>
            {state.result.warnings.map((w, i) => (
              <div key={i} className="notice warn">
                <Icon name="alert" />
                <span>{w}</span>
              </div>
            ))}
            <div className="row wrap mt-3">
              <button className="btn primary" onClick={() => window.api.recordings.showInFolder(state.result.txtPath)}>
                <Icon name="folder" />
                {reveal}
              </button>
              <button className="btn" onClick={() => window.api.recordings.open(state.result.txtPath)}>
                <Icon name="file" />
                {t('home.openTxt')}
              </button>
              <button className="btn" onClick={() => window.api.recordings.open(state.result.rawTxtPath)}>
                {t('home.openRawTxt')}
              </button>
              {state.result.format !== 'jpg' && (
                <button className="btn" onClick={() => window.api.recordings.open(state.result.mediaPath)}>
                  {t('home.openVideo')}
                </button>
              )}
            </div>
          </div>
        )}

        {state.status === 'error' && (
          <div className="card error">
            <div className="title-row">
              <span className="status-icon bad">
                <Icon name="alert" />
              </span>
              <h2>{t('home.error')}</h2>
              {dismiss}
            </div>
            <p className="mt-2 selectable">{state.message}</p>
          </div>
        )}

        {(state.status === 'recording' || state.status === 'countdown' || state.status === 'selecting') && (
          <div className="card rec-panel">
            <div className="timer">
              {state.status === 'recording' && <span className="rec-dot" />}
              {state.status === 'recording' ? <Timer since={state.startedAt} /> : state.status === 'countdown' ? state.seconds || '●' : '…'}
            </div>
            <p className="dim">{state.status === 'selecting' ? t('home.selectArea') : t('home.recording')}</p>
            <button className="btn primary big stop mt-2" onClick={() => window.api.recording.stop()}>
              {t('common.stop')}
            </button>
          </div>
        )}

        {!busy && (
          <>
            <div className="card">
              <div className="grid-2">
                <div className="field">
                  <label>{t('home.what')}</label>
                  <div className="segmented">
                    <button className={mode === 'screen' ? 'active' : ''} onClick={() => setMode('screen')}>
                      {t('home.fullScreen')}
                    </button>
                    <button className={mode === 'region' ? 'active' : ''} onClick={() => setMode('region')}>
                      {t('home.area')}
                    </button>
                  </div>
                </div>
                {displays.length > 1 && mode === 'screen' && (
                  <div className="field">
                    <label>{t('home.display')}</label>
                    <select value={displayId} onChange={(e) => setDisplayId(Number(e.target.value))}>
                      {displays.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label} ({d.bounds.width}×{d.bounds.height}
                          {d.primary ? `, ${t('home.primary')}` : ''})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="field">
                  <label>{t('home.format')}</label>
                  <div className="segmented">
                    {FORMATS.map((f) => (
                      <button key={f.id} className={settings.format === f.id ? 'active' : ''} onClick={() => update({ format: f.id })}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label>{t('home.resolution')}</label>
                  <div className="segmented">
                    {RESOLUTIONS.map((r) => (
                      <button key={r} className={settings.resolution === r ? 'active' : ''} onClick={() => update({ resolution: r })}>
                        {resolutionLabel(r)}
                      </button>
                    ))}
                  </div>
                </div>
                {settings.format === 'jpg' && (
                  <div className="field">
                    <label>{t('home.jpgFps')}</label>
                    <div className="segmented">
                      {JPG_FPS.map((f) => (
                        <button key={f} className={settings.jpgFps === f ? 'active' : ''} onClick={() => update({ jpgFps: f })}>
                          {f} fps
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="field">
                  <label>{t('home.audio')}</label>
                  <div className="segmented">
                    <button className={settings.audio ? 'active' : ''} onClick={() => update({ audio: true })}>
                      {t('home.mic')}
                    </button>
                    <button className={!settings.audio ? 'active' : ''} onClick={() => update({ audio: false })}>
                      {t('home.none')}
                    </button>
                  </div>
                </div>
              </div>
              <div className="row wrap small dim mt-2">
                <span>
                  {t('home.transcription', {
                    value: settings.audio && settings.transcribe ? (modelInstalled ? `Whisper ${settings.whisperModel}` : t('home.modelMissing')) : t('home.off')
                  })}
                </span>
                <span>· {t('home.clicks', { value: settings.trackClicks ? t('common.yes') : t('common.no') })}</span>
                <span>
                  · {t('home.shortcut', { value: '' })}
                  {shortcut ? <kbd>{shortcut}</kbd> : t('home.off')}
                </span>
                <button className="btn ghost sm" onClick={goSettings}>
                  {t('nav.settings')}
                </button>
              </div>
            </div>

            <div className="record-panel">
              <button className="btn primary big record" onClick={start}>
                {mode === 'region' ? t('home.recordAreaButton') : t('home.recordButton')}
              </button>
              <p className="hint">{shortcut ? t('home.hideNote', { shortcut }) : t('home.hideNoteNoShortcut')}</p>
            </div>
          </>
        )}

        {recordings.length > 0 && (
          <div className="card">
            <h3>{t('home.recent')}</h3>
            <div className="list">
              {recordings.map((r) => (
                <div className="list-item" key={r.dir}>
                  <div className="stack tight">
                    <strong>{formatDate(r.createdAt)}</strong>
                    <span className="small dim">
                      {formatDuration(r.durationMs)} · {r.format.toUpperCase()}
                    </span>
                  </div>
                  <div className="row">
                    <button className="btn ghost sm" onClick={() => window.api.recordings.open(r.txtPath)}>
                      {t('home.openTxt')}
                    </button>
                    <button className="btn ghost sm" onClick={() => window.api.recordings.open(r.rawTxtPath)}>
                      {t('home.openRawTxt')}
                    </button>
                    <button className="btn sm" onClick={() => window.api.recordings.showInFolder(r.txtPath)}>
                      <Icon name="folder" />
                      {reveal}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Timer({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [])
  return <>{formatDuration(now - since)}</>
}
