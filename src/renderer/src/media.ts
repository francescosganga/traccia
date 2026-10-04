/**
 * Device helpers shared by the capture engine, the pickers and the webcam bubble:
 * listing the inputs, opening the chosen one and measuring a microphone's level.
 */

import { findDevice } from '../../shared/devices'
import type { InputDevice, MicList } from '../../shared/types'

/** The same processing for the recording and for the level shown before it, so the bar shows what gets recorded. */
const PROCESSING = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }

// Chromium appends the USB vendor:product ids to some names ("FaceTime HD Camera (05ac:8514)")
const cleanLabel = (label: string) => label.replace(/ \([0-9a-f]{4}:[0-9a-f]{4}\)$/i, '')

// Chromium's aliases for the system choices: "default" follows the system input, "communications" is Windows-only.
const ALIASES = new Set(['default', 'communications'])

/** The audio inputs, without the aliases. Labels are empty until the microphone permission is granted. */
export async function listMics(): Promise<MicList> {
  const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
  const devices = all.filter((d) => d.deviceId && d.label && !ALIASES.has(d.deviceId)).map((d) => ({ id: d.deviceId, label: cleanLabel(d.label) }))
  // The alias shares its groupId with the real device, whose label is the plain name
  const alias = all.find((d) => d.deviceId === 'default')
  const real = alias && all.find((d) => !ALIASES.has(d.deviceId) && d.groupId === alias.groupId)
  return { devices, defaultLabel: real?.label ? cleanLabel(real.label) : null }
}

/** Opens the chosen microphone, or the system default when it is null or not connected. */
export async function openMic(wanted: InputDevice | null): Promise<{ stream: MediaStream; fallback: boolean }> {
  const device = wanted ? findDevice(wanted, (await listMics()).devices) : undefined
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: device ? { ...PROCESSING, deviceId: { exact: device.id } } : PROCESSING,
    video: false
  })
  return { stream, fallback: !!wanted && !device }
}

/** The cameras, by name. Labels are empty until the camera permission is granted. */
export async function listCameras(): Promise<InputDevice[]> {
  return (await navigator.mediaDevices.enumerateDevices())
    .filter((d) => d.kind === 'videoinput' && d.deviceId && d.label)
    .map((d) => ({ id: d.deviceId, label: cleanLabel(d.label) }))
}

// 720p is plenty for an overlay a quarter of the frame tall. The capture engine and the bubble
// ask for the same format, so Chromium serves both from one capture of the camera.
const CAMERA = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }

/** Opens the chosen camera, or the first one when it is null or not connected. */
export async function openCamera(wanted: InputDevice | null): Promise<MediaStream> {
  const device = wanted ? findDevice(wanted, await listCameras()) : undefined
  return navigator.mediaDevices.getUserMedia({ video: device ? { ...CAMERA, deviceId: { exact: device.id } } : CAMERA, audio: false })
}

const FLOOR_DB = -60
// Share of the previous level kept at each reading: the bar falls back smoothly instead of flickering
const RELEASE = 0.85

export interface LevelMeter {
  /** Peak level of the latest audio, 0..1 on a -60..0 dBFS scale */
  read(): number
  close(): void
}

/** Measures a stream's level without playing it (the analyser is not connected to the speakers). */
export function levelMeter(stream: MediaStream): LevelMeter {
  const ctx = new AudioContext()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  ctx.createMediaStreamSource(stream).connect(analyser)
  void ctx.resume()
  const samples = new Float32Array(analyser.fftSize)
  let level = 0
  return {
    read() {
      analyser.getFloatTimeDomainData(samples)
      let peak = 0
      for (const s of samples) peak = Math.max(peak, Math.abs(s))
      const db = peak > 0 ? 20 * Math.log10(peak) : FLOOR_DB
      const now = Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB))
      level = Math.max(now, level * RELEASE)
      return level
    },
    close() {
      void ctx.close()
    }
  }
}

/** Keeps the main process informed of the inputs, for the tray menu. */
export function installMicReporter(): void {
  const report = () =>
    void listMics()
      .then((list) => window.api.mics.report(list))
      .catch((e) => console.error('cannot list the microphones', e))
  navigator.mediaDevices.addEventListener('devicechange', report)
  // Labels appear once the permission is granted, which fires no devicechange
  window.addEventListener('focus', report)
  report()
}
