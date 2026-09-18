import { useEffect, useState } from 'react'
import { t } from '../../../shared/i18n'
import { presetOf, SHORTCUT_PRESETS, type ShortcutPreset } from '../../../shared/shortcuts'
import type { Settings } from '../../../shared/types'
import { formatShortcut, isMacScreenshotShortcut } from '../format'
import { Toggle } from './Toggle'

interface Props {
  settings: Settings
  update: (patch: Partial<Settings>) => Promise<void>
  platform: string
}

const PRESETS: ShortcutPreset[] = ['mac', 'alt', 'custom']

function ShortcutField({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <div className="field">
      <label>{label}</label>
      <div className="row">
        <input type="text" className="grow" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="btn" disabled={draft === value} onClick={() => onSave(draft)}>
          {t('common.save')}
        </button>
      </div>
    </div>
  )
}

/** On/off switch for the global shortcuts and the choice of keys; shared by the wizard and the settings page. */
export function ShortcutSettings({ settings, update, platform }: Props) {
  const { shortcutsEnabled, shortcutScreen, shortcutRegion } = settings
  const [choice, setChoice] = useState<ShortcutPreset>(presetOf(shortcutScreen, shortcutRegion))
  // "Custom" stays selected while its keys still equal a preset; only a saved preset pair moves the selection
  useEffect(() => {
    const p = presetOf(shortcutScreen, shortcutRegion)
    if (p !== 'custom') setChoice(p)
  }, [shortcutScreen, shortcutRegion])

  const choose = (p: ShortcutPreset) => {
    setChoice(p)
    if (p !== 'custom') void update({ shortcutScreen: SHORTCUT_PRESETS[p].screen, shortcutRegion: SHORTCUT_PRESETS[p].region })
  }
  const reservedByMac = platform === 'darwin' && [shortcutScreen, shortcutRegion].some(isMacScreenshotShortcut)

  return (
    <>
      <Toggle
        label={t('shortcut.enable')}
        hint={t('shortcut.enableHint')}
        value={shortcutsEnabled}
        onChange={(shortcutsEnabled) => void update({ shortcutsEnabled })}
      />
      {shortcutsEnabled && (
        <div className="mt-4">
          <div className="field">
            <label>{t('shortcut.keys')}</label>
            <div className="segmented">
              {PRESETS.map((p) => (
                <button key={p} className={choice === p ? 'active' : ''} onClick={() => choose(p)}>
                  {t(`shortcut.preset.${p}`)}
                </button>
              ))}
            </div>
          </div>
          {choice === 'custom' ? (
            <>
              <div className="grid-2">
                <ShortcutField label={t('shortcut.fieldScreen')} value={shortcutScreen} onSave={(shortcutScreen) => void update({ shortcutScreen })} />
                <ShortcutField label={t('shortcut.fieldRegion')} value={shortcutRegion} onSave={(shortcutRegion) => void update({ shortcutRegion })} />
              </div>
              <p className="small muted mt-2">{t('shortcut.customHint', { example: SHORTCUT_PRESETS.mac.screen })}</p>
            </>
          ) : (
            <p>
              <kbd>{formatShortcut(shortcutScreen, platform)}</kbd> {t('shortcut.screen')} · <kbd>{formatShortcut(shortcutRegion, platform)}</kbd>{' '}
              {t('shortcut.region')}
            </p>
          )}
          <p className="small dim mt-2">{t('shortcut.stopNote')}</p>
          {reservedByMac ? (
            <div className="row between mt-3">
              <span className="small dim">{t('shortcut.macNote')}</span>
              <button className="btn ghost sm" onClick={() => window.api.system.openKeyboardShortcuts()}>
                {t('common.openSettings')}
              </button>
            </div>
          ) : (
            choice === 'alt' && <p className="small dim mt-2">{t('shortcut.altNote')}</p>
          )}
        </div>
      )}
    </>
  )
}
