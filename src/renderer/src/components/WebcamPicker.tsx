import { useEffect, useRef, useState } from 'react'
import { t } from '../../../shared/i18n'
import { findDevice } from '../../../shared/devices'
import type { InputDevice, MediaAccessStatus } from '../../../shared/types'
import { WEBCAM_CORNERS, WEBCAM_SHAPES, webcamRadius, webcamRect, type WebcamCorner, type WebcamShape } from '../../../shared/webcam'
import { listCameras, openCamera } from '../media'
import { Segmented } from './Segmented'

interface Props {
  device: InputDevice | null
  shape: WebcamShape
  corner: WebcamCorner
  onDevice: (device: InputDevice | null) => void
  onShape: (shape: WebcamShape) => void
  onCorner: (corner: WebcamCorner) => void
  disabled?: boolean
}

// Option value of the default camera; device ids are never empty
const DEFAULT = ''
const PREVIEW_HEIGHT = 80

export const shapeOptions = (): { id: WebcamShape; label: string }[] => WEBCAM_SHAPES.map((id) => ({ id, label: t(`webcam.${id}`) }))

/**
 * Camera, shape and corner of the webcam, with a live preview in that shape. Like the
 * microphone level, the camera is open only while the window has the focus.
 */
export function WebcamPicker({ device, shape, corner, onDevice, onShape, onCorner, disabled }: Props) {
  const [cameras, setCameras] = useState<InputDevice[]>([])
  const [access, setAccess] = useState<MediaAccessStatus | null>(null)
  // A window opened hidden at login must not open the camera
  const [focused, setFocused] = useState(document.hasFocus() && document.visibilityState === 'visible')
  const video = useRef<HTMLVideoElement>(null)

  const refresh = () => {
    void window.api.system.permissions().then((p) => setAccess(p.camera))
    listCameras()
      .then(setCameras)
      .catch((e) => console.error('cannot list the cameras', e))
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

  const connected = device ? findDevice(device, cameras) : undefined
  const live = !disabled && access === 'granted' && focused

  useEffect(() => {
    if (!live) return
    let cancelled = false
    let stream: MediaStream | null = null
    openCamera(connected ?? null)
      .then((s) => {
        stream = s
        if (cancelled) return s.getTracks().forEach((track) => track.stop())
        if (video.current) video.current.srcObject = s
      })
      .catch((e) => console.error('cannot open the camera for the preview', e))
    return () => {
      cancelled = true
      stream?.getTracks().forEach((track) => track.stop())
      if (video.current) video.current.srcObject = null
    }
  }, [live, connected?.id])

  const request = async () => {
    if (access === 'denied') return window.api.system.openPrivacySettings('camera')
    setAccess((await window.api.system.requestPermission('camera')).camera)
    refresh()
  }

  // The preview has the proportions of the webcam in the video
  const sample = webcamRect(shape, corner, 1000, 1000)
  const previewWidth = Math.round((PREVIEW_HEIGHT * sample.width) / sample.height)

  return (
    <div className="webcam-picker">
      <select
        value={device ? (connected?.id ?? device.id) : DEFAULT}
        disabled={disabled}
        onChange={(e) => onDevice(e.target.value === DEFAULT ? null : (cameras.find((c) => c.id === e.target.value) ?? null))}
      >
        <option value={DEFAULT}>{cameras[0] ? t('webcam.defaultNamed', { name: cameras[0].label }) : t('webcam.default')}</option>
        {cameras.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
        {device && !connected && (
          <option value={device.id} disabled>
            {t('webcam.notConnected', { name: device.label })}
          </option>
        )}
      </select>
      {!disabled && access !== null && access !== 'granted' && (
        <div className="row wrap small dim">
          <span>{t('webcam.permission')}</span>
          <button className="btn sm" onClick={() => void request()}>
            {access === 'denied' ? t('common.openSettings') : t('common.request')}
          </button>
        </div>
      )}
      {!disabled && (
        <>
          <Segmented options={shapeOptions()} value={shape} onChange={onShape} />
          <div className="webcam-layout">
            <div
              className="webcam-preview"
              aria-label={t('webcam.preview')}
              style={{ width: previewWidth, height: PREVIEW_HEIGHT, borderRadius: webcamRadius(shape, PREVIEW_HEIGHT) }}
            >
              <video ref={video} autoPlay muted playsInline />
            </div>
            <CornerPicker shape={shape} corner={corner} onChange={onCorner} />
          </div>
        </>
      )}
    </div>
  )
}

const SCREEN_WIDTH = 128
const SCREEN_HEIGHT = 80

/** A small screen with the webcam at its corner: clicking a quarter moves it there. */
export function CornerPicker({ shape, corner, onChange }: { shape: WebcamShape; corner: WebcamCorner; onChange: (corner: WebcamCorner) => void }) {
  const rect = webcamRect(shape, corner, SCREEN_WIDTH, SCREEN_HEIGHT)
  return (
    <div className="corner-picker" role="radiogroup" aria-label={t('webcam.position')} style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }}>
      {WEBCAM_CORNERS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === corner}
          aria-label={t(`webcam.corner.${c}`)}
          title={t(`webcam.corner.${c}`)}
          onClick={() => onChange(c)}
        />
      ))}
      <span
        className="corner-mark"
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, borderRadius: webcamRadius(shape, rect.height) }}
      />
    </div>
  )
}
