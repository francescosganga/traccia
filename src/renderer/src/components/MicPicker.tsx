import { useEffect, useRef, useState } from 'react'
import { t } from '../../../shared/i18n'
import { findMic, systemDefaultLabel } from '../../../shared/mics'
import type { MediaAccessStatus, MicDevice, MicList } from '../../../shared/types'
import { levelMeter, listMics, openMic } from '../audio'

interface Props {
  value: MicDevice | null
  onChange: (device: MicDevice | null) => void
  disabled?: boolean
}

// Option value of the system default; device ids are never empty
const DEFAULT = ''

/**
 * Microphone choice with the live input level under it. The microphone is open only
 * while the window has the focus, so the system's microphone indicator goes off as
 * soon as the user moves to another app.
 */
export function MicPicker({ value, onChange, disabled }: Props) {
  const [mics, setMics] = useState<MicList>({ devices: [], defaultLabel: null })
  const [access, setAccess] = useState<MediaAccessStatus | null>(null)
  // A window opened hidden at login must not open the microphone
  const [focused, setFocused] = useState(document.hasFocus() && document.visibilityState === 'visible')
  const bar = useRef<HTMLDivElement>(null)

  const refresh = () => {
    void window.api.system.permissions().then((p) => setAccess(p.microphone))
    listMics()
      .then(setMics)
      .catch((e) => console.error('cannot list the microphones', e))
  }

  useEffect(() => {
    refresh()
    const onFocus = () => {
      setFocused(true)
      refresh()
    }
    const onBlur = () => setFocused(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      navigator.mediaDevices.removeEventListener('devicechange', refresh)
    }
  }, [])

  const connected = value ? findMic(value, mics.devices) : undefined
  const live = !disabled && access === 'granted' && focused

  useEffect(() => {
    if (!live) return
    let cancelled = false
    let frame = 0
    let stop = () => {}
    openMic(connected ?? null)
      .then(({ stream }) => {
        const meter = levelMeter(stream)
        stop = () => {
          meter.close()
          for (const track of stream.getTracks()) track.stop()
        }
        if (cancelled) return stop()
        const draw = () => {
          if (bar.current) bar.current.style.transform = `scaleX(${meter.read()})`
          frame = requestAnimationFrame(draw)
        }
        draw()
      })
      .catch((e) => console.error('cannot open the microphone for the level meter', e))
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      stop()
      if (bar.current) bar.current.style.transform = 'scaleX(0)'
    }
  }, [live, connected?.id])

  const request = async () => {
    if (access === 'denied') return window.api.system.openPrivacySettings('microphone')
    setAccess((await window.api.system.requestPermission('microphone')).microphone)
    refresh()
  }

  return (
    <div className="mic-picker">
      <select
        value={value ? (connected?.id ?? value.id) : DEFAULT}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === DEFAULT ? null : (mics.devices.find((d) => d.id === e.target.value) ?? null))}
      >
        <option value={DEFAULT}>{systemDefaultLabel(mics)}</option>
        {mics.devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
        {value && !connected && (
          <option value={value.id} disabled>
            {t('mic.notConnected', { name: value.label })}
          </option>
        )}
      </select>
      {!disabled &&
        (access !== null && access !== 'granted' ? (
          <div className="row wrap small dim">
            <span>{t('mic.permission')}</span>
            <button className="btn sm" onClick={() => void request()}>
              {access === 'denied' ? t('common.openSettings') : t('common.request')}
            </button>
          </div>
        ) : (
          <div className="meter" title={t('mic.level')} aria-hidden="true">
            <div ref={bar} />
          </div>
        ))}
    </div>
  )
}
