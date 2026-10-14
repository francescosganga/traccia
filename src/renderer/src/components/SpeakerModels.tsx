import { useEffect, useState } from 'react'
import { t } from '../../../shared/i18n'
import type { SpeakerModelStatus } from '../../../shared/types'

export function SpeakerModels() {
  const [status, setStatus] = useState<SpeakerModelStatus | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    void window.api.speakers.status().then(setStatus).catch(() => setFailed(true))
    return window.api.speakers.onProgress(setStatus)
  }, [])
  const download = () => {
    setFailed(false)
    void window.api.speakers.download().catch(() => setFailed(true))
  }
  return (
    <div className="field mt-3">
      <label>{t('speakers.title')}</label>
      {!status?.installed && <span className="hint">{t('speakers.description')}</span>}
      <div className="row wrap">
        {status?.installed ? <span>{t('speakers.ready')}</span> : status?.downloading ? (
          <>
            <span>{t('speakers.downloading', { percent: Math.round(status.progress * 100) })}</span>
            <button className="btn sm" onClick={() => void window.api.speakers.cancel()}>{t('common.cancel')}</button>
          </>
        ) : <button className="btn sm" disabled={!status} onClick={download}>{t('speakers.download')}</button>}
      </div>
      {status?.downloading && <div className="progress"><div style={{ width: `${status.progress * 100}%` }} /></div>}
      {(failed || status?.error) && <span className="text-warn">{status?.error || t('speakers.downloadFailed')}</span>}
    </div>
  )
}
