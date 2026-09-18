import { useEffect, useState } from 'react'
import { t } from '../../../shared/i18n'
import type { DownloadProgress, WhisperModelId, WhisperModelInfo } from '../../../shared/types'
import { formatBytes } from '../format'

interface Props {
  selected: WhisperModelId
  onSelect: (id: WhisperModelId) => void
  compact?: boolean
}

export function ModelManager({ selected, onSelect, compact }: Props) {
  const [models, setModels] = useState<WhisperModelInfo[]>([])
  const [downloads, setDownloads] = useState<Record<string, DownloadProgress>>({})
  const [dir, setDir] = useState('')

  const refresh = () => void window.api.whisper.models().then(setModels)

  useEffect(() => {
    refresh()
    void window.api.whisper.dir().then(setDir)
    return window.api.whisper.onProgress((p) => {
      setDownloads((d) => ({ ...d, [p.model]: p }))
      if (p.status !== 'progress') {
        refresh()
        setTimeout(
          () =>
            setDownloads((d) => {
              const copy = { ...d }
              delete copy[p.model]
              return copy
            }),
          p.status === 'error' ? 6000 : 0
        )
      }
    })
  }, [])

  const download = (id: WhisperModelId) => {
    setDownloads((d) => ({ ...d, [id]: { model: id, status: 'progress', progress: 0 } }))
    window.api.whisper.download(id).catch(() => refresh())
  }

  const remove = async (id: WhisperModelId) => {
    if (!confirm(t('model.confirmDelete', { id }))) return
    await window.api.whisper.delete(id)
    refresh()
  }

  return (
    <div>
      {models.map((m) => {
        const dl = downloads[m.id]
        const active = m.installed && selected === m.id
        return (
          <div className="model" key={m.id}>
            <div className="info">
              <div className="row">
                <strong>Whisper {m.label}</strong>
                <span className="dim small">{m.installed ? t('model.onDisk', { size: formatBytes(m.sizeOnDisk) }) : m.sizeLabel}</span>
                {m.installed && (
                  <span className={`badge ${active ? 'ok' : ''}`}>
                    <span className="dot" /> {active ? t('model.inUse') : t('model.installed')}
                  </span>
                )}
              </div>
              {!compact && <div className="small dim">{m.description}</div>}
              {m.cachedPath && !dl && <div className="small text-ok">{t('model.foundInCache', { path: m.cachedPath })}</div>}
              {dl && dl.status === 'progress' && (
                <>
                  <div className="progress">
                    <div style={{ width: `${Math.round(dl.progress * 100)}%` }} />
                  </div>
                  <div className="small dim mt-1">
                    {m.cachedPath ? t('model.importing') : t('model.downloading', { percent: Math.round(dl.progress * 100) })} {dl.file ? `· ${dl.file}` : ''}
                  </div>
                </>
              )}
              {dl && dl.status === 'error' && (
                <div className="small text-danger">
                  {t('model.downloadFailed', { error: dl.error ?? '' })}
                </div>
              )}
            </div>
            <div className="row">
              {dl && dl.status === 'progress' ? (
                <button className="btn" onClick={() => window.api.whisper.cancel(m.id)}>
                  {t('common.cancel')}
                </button>
              ) : m.installed ? (
                <>
                  {!active && (
                    <button className="btn" onClick={() => onSelect(m.id)}>
                      {t('common.use')}
                    </button>
                  )}
                  <button className="btn danger" onClick={() => remove(m.id)}>
                    {t('common.delete')}
                  </button>
                </>
              ) : (
                <button className="btn" onClick={() => download(m.id)}>
                  {m.cachedPath ? t('model.import') : t('common.download')}
                </button>
              )}
            </div>
          </div>
        )
      })}
      {!compact && dir && (
        <p className="small dim mt-3">
          {t('model.storedIn', { dir })}
        </p>
      )}
    </div>
  )
}
