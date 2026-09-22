import { useEffect, useState, type FormEvent } from 'react'
import { t } from '../../../shared/i18n'
import type { AppState, CaptureMode, DisplayInfo, OutputFormat, RecordingEntry, RecordingOverrides, Settings } from '../../../shared/types'
import { Icon } from '../components/Icon'
import { Menu, type MenuItem } from '../components/Menu'
import { Segmented } from '../components/Segmented'
import { formatDate, formatDuration, formatShortcut } from '../format'
import { FORMATS, JPG_FPS, RESOLUTIONS, resolutionLabel } from '../options'
import type { SettingsSection } from './Settings'

interface Props {
  settings: Settings
  state: AppState
  modelInstalled: boolean
  platform: string
  goSettings: (section?: SettingsSection) => void
}

/** The choices on this page apply to the next recording only; the defaults live in Settings. */
type Choices = Required<Pick<RecordingOverrides, 'format' | 'resolution' | 'jpgFps' | 'audio'>>
const defaultsOf = (s: Settings): Choices => ({ format: s.format, resolution: s.resolution, jpgFps: s.jpgFps, audio: s.audio })

/** What the actions menu of a recording needs, whether it comes from the "done" card or from the recent list. */
interface RecordingRef {
  dir: string
  name: string
  format: OutputFormat
  txtPath: string
  rawTxtPath: string
  mediaPath: string
}

const folderName = (dir: string): string => dir.split(/[\\/]/).pop() ?? dir

export function Home({ settings, state, modelInstalled, platform, goSettings }: Props) {
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [recordings, setRecordings] = useState<RecordingEntry[]>([])
  const [mode, setMode] = useState<CaptureMode>(settings.lastMode)
  const [displayId, setDisplayId] = useState<number | undefined>(settings.lastDisplayId ?? undefined)
  const [choices, setChoices] = useState<Choices>(() => defaultsOf(settings))
  // Folder of the recording whose name is being edited
  const [renaming, setRenaming] = useState<string | null>(null)

  const refreshRecordings = () => void window.api.recordings.list().then(setRecordings)
  const choose = (patch: Partial<Choices>) => setChoices((c) => ({ ...c, ...patch }))

  useEffect(() => {
    void window.api.system.displays().then((d) => {
      setDisplays(d)
      if (!d.some((x) => x.id === displayId)) setDisplayId(d.find((x) => x.primary)?.id ?? d[0]?.id)
    })
    refreshRecordings()
  }, [])
  // The page goes back to the defaults when they change, and once a recording has ended
  useEffect(() => setChoices(defaultsOf(settings)), [settings.format, settings.resolution, settings.jpgFps, settings.audio])
  useEffect(() => {
    if (state.status === 'done' || state.status === 'error') {
      setChoices(defaultsOf(settings))
      refreshRecordings()
    }
  }, [state.status])

  const start = () => void window.api.recording.start({ mode, displayId, overrides: choices })
  const reveal = platform === 'darwin' ? t('home.revealMac') : t('home.revealOther')
  const busy = state.status === 'processing' || state.status === 'recording' || state.status === 'countdown' || state.status === 'selecting'
  const shortcut = settings.shortcutsEnabled ? formatShortcut(mode === 'region' ? settings.shortcutRegion : settings.shortcutScreen, platform) : null
  const modelMissing = choices.audio && settings.transcribe && !modelInstalled
  const countdown = settings.countdown > 0 ? t('home.seconds', { n: settings.countdown }) : t('home.off')
  const dismiss = (
    <button className="btn ghost icon-btn" aria-label={t('common.cancel')} onClick={() => window.api.recording.reset()}>
      <Icon name="x" />
    </button>
  )

  const rename = async (dir: string, title: string) => {
    await window.api.recordings.rename(dir, title)
    setRenaming(null)
    refreshRecordings()
  }
  const trash = async (r: RecordingRef) => {
    if (!confirm(t('home.confirmTrash', { name: r.name }))) return
    await window.api.recordings.trash(r.dir)
    refreshRecordings()
  }
  const actions = (r: RecordingRef): MenuItem[] => [
    { label: t('home.openTxt'), onSelect: () => void window.api.recordings.open(r.txtPath) },
    { label: t('home.openRawTxt'), onSelect: () => void window.api.recordings.open(r.rawTxtPath) },
    ...(r.format !== 'jpg' ? [{ label: t('home.openVideo'), onSelect: () => void window.api.recordings.open(r.mediaPath) }] : []),
    { label: t('home.rename'), onSelect: () => setRenaming(r.dir) },
    { label: t('home.trash'), onSelect: () => void trash(r), danger: true }
  ]

  const done = state.status === 'done' ? state.result : null
  // The list, refreshed when the recording ends, carries the name given to it
  const doneEntry = done ? recordings.find((r) => r.dir === done.dir) : undefined

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
              {state.canSkipTranscription && (
                <button className="btn sm" onClick={() => window.api.recording.skipTranscription()}>
                  {t('home.skipTranscription')}
                </button>
              )}
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

        {done && (
          <div className="card success">
            <div className="title-row">
              <span className="status-icon ok">
                <Icon name="check" />
              </span>
              <h2>{doneEntry?.title || t('home.done')}</h2>
              {dismiss}
            </div>
            {renaming === done.dir && (
              <NameEditor className="mt-3" initial={doneEntry?.title ?? ''} onSave={(title) => void rename(done.dir, title)} onCancel={() => setRenaming(null)} />
            )}
            <p className="dim mt-2">
              {doneEntry?.title ? `${t('home.done')} · ` : ''}
              {formatDuration(done.durationMs)} · {done.width}×{done.height} · {done.format.toUpperCase()}
              {done.frames !== undefined && ` · ${t('home.frames', { n: done.frames })}${done.skippedFrames ? ' ' + t('home.skipped', { n: done.skippedFrames }) : ''}`}
              {done.transcriptSegments !== undefined && ` · ${t('home.segments', { n: done.transcriptSegments })}`}
            </p>
            {done.warnings.map((w, i) => (
              <div key={i} className="notice warn">
                <Icon name="alert" />
                <span>{w}</span>
              </div>
            ))}
            <div className="row wrap mt-3">
              <CopyPromptButton promptPath={done.promptPath} className="btn primary" />
              <button className="btn" onClick={() => window.api.recordings.showInFolder(done.txtPath)}>
                <Icon name="folder" />
                {reveal}
              </button>
              <Menu
                label={t('home.more')}
                items={actions({
                  dir: done.dir,
                  name: doneEntry?.title || folderName(done.dir),
                  format: done.format,
                  txtPath: done.txtPath,
                  rawTxtPath: done.rawTxtPath,
                  mediaPath: done.mediaPath
                })}
              />
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
                  <Segmented<CaptureMode>
                    options={[
                      { id: 'screen', label: t('home.fullScreen') },
                      { id: 'region', label: t('home.area') }
                    ]}
                    value={mode}
                    onChange={setMode}
                  />
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
                  <Segmented options={FORMATS} value={choices.format} onChange={(format) => choose({ format })} />
                </div>
                <div className="field">
                  <label>{t('home.resolution')}</label>
                  <Segmented options={RESOLUTIONS.map((r) => ({ id: r, label: resolutionLabel(r) }))} value={choices.resolution} onChange={(resolution) => choose({ resolution })} />
                </div>
                {choices.format === 'jpg' && (
                  <div className="field">
                    <label>{t('home.jpgFps')}</label>
                    <Segmented options={JPG_FPS.map((f) => ({ id: f, label: `${f} fps` }))} value={choices.jpgFps} onChange={(jpgFps) => choose({ jpgFps })} />
                  </div>
                )}
                <div className="field">
                  <label>{t('home.audio')}</label>
                  <Segmented<'mic' | 'none'>
                    options={[
                      { id: 'mic', label: t('home.mic') },
                      { id: 'none', label: t('home.none') }
                    ]}
                    value={choices.audio ? 'mic' : 'none'}
                    onChange={(v) => choose({ audio: v === 'mic' })}
                  />
                </div>
              </div>
              <div className="row wrap small dim mt-2">
                <button className={`link ${modelMissing ? 'text-warn' : ''}`} onClick={() => goSettings('audio')}>
                  {t('home.transcription', {
                    value: choices.audio && settings.transcribe ? (modelMissing ? t('home.modelMissing') : `Whisper ${settings.whisperModel}`) : t('home.off')
                  })}
                </button>
                <span>·</span>
                <button className="link" onClick={() => goSettings('cursor')}>
                  {t('home.clicks', { value: settings.trackClicks ? t('common.yes') : t('common.no') })}
                </button>
                <span>·</span>
                <button className="link" onClick={() => goSettings('recording')}>
                  {t('home.countdown', { value: countdown })}
                </button>
                <span>·</span>
                <button className="link" onClick={() => goSettings('shortcuts')}>
                  {t('home.shortcut', { value: '' })}
                  {shortcut ? <kbd>{shortcut}</kbd> : t('home.off')}
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
                  <div className="stack tight grow">
                    {renaming === r.dir ? (
                      <NameEditor initial={r.title ?? ''} onSave={(title) => void rename(r.dir, title)} onCancel={() => setRenaming(null)} />
                    ) : (
                      <strong>{r.title || formatDate(r.createdAt)}</strong>
                    )}
                    <span className="small dim">
                      {r.title ? `${formatDate(r.createdAt)} · ` : ''}
                      {formatDuration(r.durationMs)} · {r.format.toUpperCase()}
                    </span>
                  </div>
                  <div className="row">
                    {r.promptPath && <CopyPromptButton promptPath={r.promptPath} className="btn ghost sm" />}
                    <button className="btn sm" onClick={() => window.api.recordings.showInFolder(r.txtPath)}>
                      <Icon name="folder" />
                      {reveal}
                    </button>
                    <Menu
                      label={t('home.more')}
                      items={actions({
                        dir: r.dir,
                        name: r.title || formatDate(r.createdAt),
                        format: r.format,
                        txtPath: r.txtPath,
                        rawTxtPath: r.rawTxtPath,
                        mediaPath: r.mediaPath
                      })}
                    />
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

/** Inline editor for the name of a recording: Enter saves, Escape cancels, an empty name removes it. */
function NameEditor({ initial, onSave, onCancel, className }: { initial: string; onSave: (title: string) => void; onCancel: () => void; className?: string }) {
  const [title, setTitle] = useState(initial)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSave(title)
  }
  return (
    <form className={`row ${className ?? ''}`} onSubmit={submit}>
      <input
        type="text"
        className="grow"
        autoFocus
        maxLength={80}
        placeholder={t('home.namePlaceholder')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
      />
      <button type="submit" className="btn">
        {t('common.save')}
      </button>
      <button type="button" className="btn ghost" onClick={onCancel}>
        {t('common.cancel')}
      </button>
    </form>
  )
}

/**
 * Puts "Read the file …/PROMPT.md" in the clipboard: the one line to paste into an
 * AI agent so it finds the recording and the instructions on how to read it.
 */
function CopyPromptButton({ promptPath, className }: { promptPath: string; className: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  const copy = () => void window.api.system.copyText(t('prompt.clipboard', { path: promptPath })).then(() => setCopied(true))
  return (
    <button className={className} onClick={copy} title={t('prompt.clipboard', { path: promptPath })}>
      <Icon name={copied ? 'check' : 'copy'} />
      {copied ? t('home.copied') : t('home.copyPrompt')}
    </button>
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
