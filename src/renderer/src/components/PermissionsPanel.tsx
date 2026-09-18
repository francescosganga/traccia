import { useEffect, useState } from 'react'
import { t } from '../../../shared/i18n'
import type { Permissions } from '../../../shared/types'

type Kind = 'screen' | 'microphone' | 'accessibility'
const KINDS: Kind[] = ['screen', 'microphone', 'accessibility']

export function PermissionsPanel() {
  const [perms, setPerms] = useState<Permissions | null>(null)
  const [platform, setPlatform] = useState('darwin')

  const refresh = () => void window.api.system.permissions().then(setPerms)

  useEffect(() => {
    refresh()
    void window.api.system.platform().then(setPlatform)
    const timer = setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [])

  if (platform !== 'darwin') return <p className="dim">{t('perm.notNeeded')}</p>
  if (!perms) return null

  const status = (kind: Kind): { ok: boolean; text: string } => {
    if (kind === 'accessibility') return { ok: perms.accessibility, text: perms.accessibility ? t('perm.granted') : t('perm.notGranted') }
    const s = perms[kind]
    return { ok: s === 'granted', text: s === 'granted' ? t('perm.granted') : s === 'denied' ? t('perm.denied') : t('perm.notDetermined') }
  }

  return (
    <div className="list">
      {KINDS.map((kind) => {
        const s = status(kind)
        return (
          <div className="list-item" key={kind}>
            <div className="stack tight">
              <div className="row">
                <strong>{t(`perm.${kind}.label`)}</strong>
                <span className={`badge ${s.ok ? 'ok' : 'warn'}`}>
                  <span className="dot" /> {s.text}
                </span>
              </div>
              <span className="small dim">{t(`perm.${kind}.why`)}</span>
            </div>
            <div className="row">
              {!s.ok && (
                <button className="btn sm" onClick={() => window.api.system.requestPermission(kind).then(setPerms)}>
                  {t('common.request')}
                </button>
              )}
              <button className="btn ghost sm" onClick={() => window.api.system.openPrivacySettings(kind)}>
                {t('common.openSettings')}
              </button>
            </div>
          </div>
        )
      })}
      <p className="small dim mt-3">
        {t('perm.restartNote')}
      </p>
    </div>
  )
}
