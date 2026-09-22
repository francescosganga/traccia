import { useEffect, useState } from 'react'
import { t } from '../../../shared/i18n'
import { presetOf, SHORTCUT_PRESETS, type ShortcutPreset } from '../../../shared/shortcuts'
import type { Settings } from '../../../shared/types'
import { formatShortcut, isMacScreenshotShortcut } from '../format'
import { Segmented } from './Segmented'
import { ShortcutRecorder } from './ShortcutRecorder'
import { Toggle } from './Toggle'

interface Props {
  settings: Settings
  update: (patch: Partial<Settings>) => Promise<void>
  platform: string
}

const PRESETS: ShortcutPreset[] = ['mac', 'alt', 'custom']

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
            <Segmented options={PRESETS.map((p) => ({ id: p, label: t(`shortcut.preset.${p}`) }))} value={choice} onChange={choose} />
          </div>
          {choice === 'custom' ? (
            <>
              <div className="grid-2">
                <ShortcutRecorder label={t('shortcut.fieldScreen')} value={shortcutScreen} platform={platform} onChange={(shortcutScreen) => void update({ shortcutScreen })} />
                <ShortcutRecorder label={t('shortcut.fieldRegion')} value={shortcutRegion} platform={platform} onChange={(shortcutRegion) => void update({ shortcutRegion })} />
              </div>
              <p className="small muted mt-2">{t('shortcut.customHint')}</p>
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
