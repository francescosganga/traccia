import { Menu, Tray, app, nativeImage, shell, type MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { locale, t } from '../shared/i18n'
import type { AppState, OutputFormat, Resolution } from '../shared/types'
import { applySettings } from './apply-settings'
import { listRecordings } from './recordings'
import { getSettings } from './settings'
import { formatTime } from './timeline'

export interface TrayActions {
  recordScreen(): void
  recordRegion(): void
  stop(): void
  open(): void
  settings(): void
}

let tray: Tray | null = null
let timer: NodeJS.Timeout | null = null
let actions: TrayActions | null = null
let lastState: AppState = { status: 'idle' }

function iconPath(): string {
  const base = app.isPackaged ? join(process.resourcesPath, 'resources') : join(__dirname, '../../resources')
  return join(base, 'trayTemplate.png')
}

export function createTray(trayActions: TrayActions): void {
  actions = trayActions
  const image = nativeImage.createFromPath(iconPath())
  image.setTemplateImage(true)
  tray = new Tray(image)
  tray.setToolTip('Traccia')
  void refreshTray()
}

/** Rebuilds the menu from the current state, settings and recordings list. */
export async function updateTray(state: AppState): Promise<void> {
  lastState = state
  await refreshTray()
}

export async function refreshTray(): Promise<void> {
  if (!tray || !actions) return
  const state = lastState
  const settings = getSettings()
  const recording = state.status === 'recording' || state.status === 'countdown'
  const idle = state.status === 'idle' || state.status === 'done' || state.status === 'error'

  const radio = <T extends string | number>(current: T, value: T, label: string, patch: (v: T) => void): MenuItemConstructorOptions => ({
    label,
    type: 'radio',
    checked: current === value,
    click: () => patch(value)
  })
  const formats: { id: OutputFormat; label: string }[] = [
    { id: 'mp4', label: 'MP4' },
    { id: 'mov', label: 'MOV' },
    { id: 'webm', label: 'WebM' },
    { id: 'jpg', label: 'JPG + txt' }
  ]
  const resolutions: { id: Resolution; label: string }[] = [
    { id: 'native', label: t('home.native') },
    { id: '1080', label: '1080p' },
    { id: '720', label: '720p' },
    { id: '480', label: '480p' }
  ]

  const recordings = await listRecordings(settings.outputDir, 5).catch(() => [])
  const reveal = process.platform === 'darwin' ? t('tray.revealMac') : t('tray.revealOther')
  const recentItems: MenuItemConstructorOptions[] = recordings.length
    ? recordings.map((r) => ({
        label: `${new Date(r.createdAt).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' })} · ${formatTime(r.durationMs).slice(0, 5)} · ${r.format.toUpperCase()}`,
        submenu: [
          { label: t('tray.openTxt'), click: () => void shell.openPath(r.txtPath) },
          { label: t('tray.openRawTxt'), click: () => void shell.openPath(r.rawTxtPath) },
          { label: reveal, click: () => shell.showItemInFolder(r.txtPath) }
        ]
      }))
    : [{ label: t('tray.noRecordings'), enabled: false }]

  const template: MenuItemConstructorOptions[] = [
    { label: t('tray.recordScreen'), enabled: idle, click: actions.recordScreen },
    { label: t('tray.recordRegion'), enabled: idle, click: actions.recordRegion },
    { label: t('tray.stop'), enabled: recording, click: actions.stop },
    { type: 'separator' },
    {
      label: t('tray.format'),
      submenu: [
        ...formats.map((f) => radio(settings.format, f.id, f.label, (format) => applySettings({ format }))),
        { type: 'separator' },
        { label: t('tray.jpgFps'), enabled: false },
        ...[1, 2, 4].map((fps) => radio(settings.jpgFps, fps, `${fps} fps`, (jpgFps) => applySettings({ jpgFps })))
      ]
    },
    {
      label: t('tray.resolution'),
      submenu: resolutions.map((r) => radio(settings.resolution, r.id, r.label, (resolution) => applySettings({ resolution })))
    },
    { label: t('tray.mic'), type: 'checkbox', checked: settings.audio, click: () => applySettings({ audio: !settings.audio }) },
    {
      label: t('tray.transcribe'),
      type: 'checkbox',
      checked: settings.transcribe,
      enabled: settings.audio,
      click: () => applySettings({ transcribe: !settings.transcribe })
    },
    { label: t('tray.clicks'), type: 'checkbox', checked: settings.trackClicks, click: () => applySettings({ trackClicks: !settings.trackClicks }) },
    { type: 'separator' },
    { label: t('tray.recent'), submenu: [...recentItems, { type: 'separator' }, { label: t('tray.openFolder'), click: () => void shell.openPath(settings.outputDir) }] },
    { type: 'separator' },
    { label: t('tray.open'), click: actions.open },
    { label: t('tray.settings'), click: actions.settings },
    { type: 'separator' },
    { label: t('tray.quit'), role: 'quit' }
  ]
  tray.setContextMenu(Menu.buildFromTemplate(template))

  if (timer) clearInterval(timer)
  timer = null
  if (state.status === 'recording') {
    const startedAt = state.startedAt
    const tick = () => tray?.setTitle(` ● ${formatTime(Date.now() - startedAt).slice(0, 5)}`)
    tick()
    timer = setInterval(tick, 1000)
  } else if (state.status === 'countdown') {
    tray.setTitle(state.seconds > 0 ? ` ${state.seconds}` : ' ●')
  } else if (state.status === 'processing') {
    tray.setTitle(' ⏳')
  } else {
    tray.setTitle('')
  }
}
