import { useEffect, useState } from 'react'
import { t } from '../../../shared/i18n'
import type { Settings, SpeechLanguage, WhisperModelId, WhisperModelInfo } from '../../../shared/types'
import { MicPicker } from './MicPicker'
import { ShortcutRecorder } from './ShortcutRecorder'
import { Toggle } from './Toggle'

export function DictationSettings({ settings, update, platform }: { settings: Settings; update: (patch: Partial<Settings>) => Promise<void>; platform: string }) {
  const [registered, setRegistered] = useState(false)
  const [models, setModels] = useState<WhisperModelInfo[]>([])
  useEffect(() => {
    void window.api.dictation.shortcutStatus().then(setRegistered)
    const off = window.api.dictation.onShortcutStatus(setRegistered)
    const refresh = () => void window.api.whisper.models().then(setModels)
    refresh()
    const offModels = window.api.whisper.onProgress(refresh)
    return () => { off(); offModels() }
  }, [])
  return (
    <>
      <p className="dim">{t('dictation.autoHint')}</p>
      <p className="hint">{t('dictation.local')}</p>
      <div className="field">
        <label>{t('settings.micDevice')}</label>
        <MicPicker value={settings.dictationMic} preview={false} onChange={(dictationMic) => void update({ dictationMic })} />
      </div>
      <div className="field">
        <label>{t('settings.models')}</label>
        <select value={settings.dictationModel} onChange={(event) => void update({ dictationModel: event.target.value as WhisperModelId })}>
          {models.map((model) => <option value={model.id} key={model.id}>Whisper {model.label} · {model.installed ? t('model.installed') : model.sizeLabel}</option>)}
        </select>
        <span className="hint">{t('dictation.modelRequired')}</span>
      </div>
      <div className="field">
        <label>{t('settings.speechLanguage')}</label>
        <select value={settings.dictationLanguage} onChange={(event) => void update({ dictationLanguage: event.target.value as SpeechLanguage })}>
          <option value="auto">{t('settings.autoDetect')}</option>
          {[['it', 'Italiano'], ['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português']].map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      <Toggle label={t('dictation.shortcutEnabled')} hint={t('dictation.shortcutHint')} value={settings.dictationShortcutEnabled} onChange={(dictationShortcutEnabled) => void update({ dictationShortcutEnabled })} />
      {settings.dictationShortcutEnabled && <div className="mt-3">
        <ShortcutRecorder label={t('dictation.shortcut')} value={settings.dictationShortcut} platform={platform} onChange={(dictationShortcut) => void update({ dictationShortcut })} />
        <p className={`hint ${registered ? '' : 'text-warn'}`}>{t(registered ? 'dictation.shortcutReady' : 'dictation.shortcutUnavailable')}</p>
      </div>}
      <p className="hint">{t('dictation.accessibility')}</p>
      <button className="btn" onClick={() => void window.api.system.requestPermission('accessibility')}>{t('dictation.allowAccessibility')}</button>
      <button className="btn" onClick={() => void window.api.dictation.open()}>{t('dictation.open')}</button>
    </>
  )
}
