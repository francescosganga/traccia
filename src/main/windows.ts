import { BrowserWindow, app, nativeTheme, screen, shell, type Display } from 'electron'
import { join } from 'path'
import type { Rect } from '../shared/types'
import { webcamRect, type WebcamLayout } from '../shared/webcam'
import { getSettings } from './settings'

const PRELOAD = () => join(__dirname, '../preload/index.js')

/**
 * Whole pixels for a window's bounds. A region dragged on a trackpad comes in fractional
 * DIP, and the BrowserWindow constructor ignores a fractional x or y and centres the window
 * (setBounds rounds them instead).
 */
const whole = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) })

function load(win: BrowserWindow, page: string, query: Record<string, string> = {}): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    const qs = new URLSearchParams(query).toString()
    void win.loadURL(`${devUrl}/${page}.html${qs ? '?' + qs : ''}`)
  } else {
    void win.loadFile(join(__dirname, `../renderer/${page}.html`), { query })
  }
}

// ---- main window -------------------------------------------------------------

let mainWindow: BrowserWindow | null = null
let quitting = false

export function setQuitting(): void {
  quitting = true
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function createMainWindow(opts: { show?: boolean } = {}): BrowserWindow {
  if (getMainWindow()) return mainWindow!
  const showOnReady = opts.show ?? true
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    title: 'Traccia',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111114' : '#f5f5f7',
    show: false,
    webPreferences: {
      preload: PRELOAD(),
      // The MediaRecorder engine runs here while the window is hidden.
      backgroundThrottling: false
    }
  })
  mainWindow.once('ready-to-show', () => {
    if (showOnReady) mainWindow?.show()
  })
  mainWindow.on('close', (e) => {
    // Behave like a menu-bar app: closing the window keeps the app (and recordings) alive.
    if (!quitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  load(mainWindow, 'index')
  return mainWindow
}

export function showMainWindow(): void {
  const win = createMainWindow()
  // The floating windows below are made visible over fullscreen apps, and Electron does that by
  // hiding the Dock icon: without it back, the window falls behind the other apps' windows with
  // no Dock icon or Cmd+Tab to return to it, only the tray.
  if (getSettings().showInDock && app.dock && !app.dock.isVisible()) void app.dock.show()
  win.show()
  win.focus()
}

export function hideMainWindow(): void {
  getMainWindow()?.hide()
}

/** Sends an event to every open window. */
export function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

// ---- region selector ---------------------------------------------------------

export interface RegionSelection {
  displayId: number
  rect: Rect
}

let overlays: BrowserWindow[] = []
let regionResolve: ((r: RegionSelection | null) => void) | null = null

/** Opens a transparent overlay on every display and resolves with the dragged rectangle. */
export function selectRegion(): Promise<RegionSelection | null> {
  closeOverlays()
  return new Promise((resolve) => {
    regionResolve = resolve
    for (const display of screen.getAllDisplays()) {
      const win = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        frame: false,
        transparent: true,
        hasShadow: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        enableLargerThanScreen: true,
        show: false,
        webPreferences: { preload: PRELOAD() }
      })
      win.setAlwaysOnTop(true, 'screen-saver')
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      win.once('ready-to-show', () => {
        win.setBounds(display.bounds)
        win.show()
      })
      load(win, 'region', { displayId: String(display.id) })
      overlays.push(win)
    }
  })
}

export function resolveRegion(selection: RegionSelection | null): void {
  const r = regionResolve
  regionResolve = null
  closeOverlays()
  r?.(selection)
}

function closeOverlays(): void {
  for (const w of overlays) if (!w.isDestroyed()) w.close()
  overlays = []
}

// ---- floating controls widget ------------------------------------------------

let controls: BrowserWindow | null = null

export function showControls(display: Display): void {
  hideControls()
  const width = 320
  const height = CONTROLS_HEIGHT
  const { workArea } = display
  controls = new BrowserWindow({
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + workArea.height - height - 24),
    width,
    height,
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    // The widget is never the active window: without this the first click (Stop, the webcam menu) only activates it
    acceptFirstMouse: true,
    webPreferences: { preload: PRELOAD() }
  })
  // Excludes the widget from screen capture (NSWindowSharingNone on macOS).
  controls.setContentProtection(true)
  controls.setAlwaysOnTop(true, 'screen-saver')
  controls.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  controls.once('ready-to-show', () => controls?.showInactive())
  load(controls, 'controls')
}

// Bar height, and the most the widget grows to when its webcam menu is open
const CONTROLS_HEIGHT = 60
const CONTROLS_MAX_HEIGHT = 400

/** The widget grows upwards to make room for its menu, keeping the bar where it is (even after a drag). */
export function resizeControls(height: number): void {
  if (!controls || controls.isDestroyed()) return
  const b = controls.getBounds()
  const h = Math.round(Math.min(CONTROLS_MAX_HEIGHT, Math.max(CONTROLS_HEIGHT, height)))
  controls.setBounds({ x: b.x, y: b.y + b.height - h, width: b.width, height: h })
  // macOS draws the shadow of a transparent window from its content at the time it was shown
  if (process.platform === 'darwin') controls.invalidateShadow()
}

/** Sends an event to the widget only: the microphone level arrives many times a second. */
export function sendToControls(channel: string, payload?: unknown): void {
  if (controls && !controls.isDestroyed()) controls.webContents.send(channel, payload)
}

export function hideControls(): void {
  if (controls && !controls.isDestroyed()) controls.close()
  controls = null
}

// ---- region frame ----------------------------------------------------------------

let regionFrame: BrowserWindow | null = null
// Room for the 2 px border outside the region, so nothing covers what is being captured
const FRAME_PAD = 4

/** Outline of the region being recorded: click-through, above everything and excluded from the capture like the widget. */
export function showRegionFrame(display: Display, rect: Rect): void {
  hideRegionFrame()
  regionFrame = new BrowserWindow({
    ...whole({
      x: display.bounds.x + rect.x - FRAME_PAD,
      y: display.bounds.y + rect.y - FRAME_PAD,
      width: rect.width + FRAME_PAD * 2,
      height: rect.height + FRAME_PAD * 2
    }),
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    enableLargerThanScreen: true,
    show: false
  })
  regionFrame.setIgnoreMouseEvents(true)
  regionFrame.setContentProtection(true)
  regionFrame.setAlwaysOnTop(true, 'screen-saver')
  regionFrame.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  regionFrame.once('ready-to-show', () => regionFrame?.showInactive())
  load(regionFrame, 'frame')
}

export function hideRegionFrame(): void {
  if (regionFrame && !regionFrame.isDestroyed()) regionFrame.close()
  regionFrame = null
}

// ---- webcam bubble -----------------------------------------------------------------

let webcamBubble: BrowserWindow | null = null
// Where the bubble lives, for moving it when the layout changes
let bubbleArea: { display: Display; area: Rect } | null = null

function bubbleBounds(layout: WebcamLayout): Rect {
  const { display, area } = bubbleArea!
  const rect = webcamRect(layout.shape, layout.corner, area.width, area.height)
  return whole({ x: display.bounds.x + area.x + rect.x, y: display.bounds.y + area.y + rect.y, width: rect.width, height: rect.height })
}

/**
 * The webcam as the user sees it while recording: at the corner and the size it will have
 * in the video, click-through and excluded from the capture (the video gets the webcam's
 * own file, laid over the screen when it is put together). `area` is the recorded region,
 * or the whole display, in DIP relative to the display.
 */
export function showWebcamBubble(display: Display, area: Rect, layout: WebcamLayout): void {
  hideWebcamBubble()
  bubbleArea = { display, area }
  webcamBubble = new BrowserWindow({
    ...bubbleBounds(layout),
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: { preload: PRELOAD() }
  })
  webcamBubble.setIgnoreMouseEvents(true)
  webcamBubble.setContentProtection(true)
  webcamBubble.setAlwaysOnTop(true, 'screen-saver')
  webcamBubble.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  webcamBubble.once('ready-to-show', () => {
    if (layout.visible) webcamBubble?.showInactive()
  })
  load(webcamBubble, 'webcam', { shape: layout.shape })
}

/** A change from the widget: the bubble moves, resizes and takes the new shape, or hides. */
export function updateWebcamBubble(layout: WebcamLayout): void {
  if (!webcamBubble || webcamBubble.isDestroyed() || !bubbleArea) return
  webcamBubble.setBounds(bubbleBounds(layout))
  webcamBubble.webContents.send('webcam:layout', layout)
  if (!layout.visible) webcamBubble.hide()
  else if (!webcamBubble.isVisible()) webcamBubble.showInactive()
}

export function hideWebcamBubble(): void {
  if (webcamBubble && !webcamBubble.isDestroyed()) webcamBubble.close()
  webcamBubble = null
  bubbleArea = null
}
