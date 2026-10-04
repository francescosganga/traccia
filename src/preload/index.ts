import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AgentInstallResult,
  AgentTarget,
  AgentTargetStatus,
  AppState,
  DisplayInfo,
  DownloadProgress,
  EngineStartCommand,
  EngineStartedInfo,
  LoginItemStatus,
  McpCommands,
  MicList,
  PermissionKind,
  Permissions,
  RecordingEntry,
  RecordingMedia,
  RecordingRequest,
  Settings,
  SideTrackKind,
  WhisperModelId,
  WhisperModelInfo
} from '../shared/types'
import type { WebcamLayout } from '../shared/webcam'

type Unsubscribe = () => void

function on<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    update: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:update', patch),
    onChange: (cb: (s: Settings) => void) => on<Settings>('settings:changed', cb),
    chooseDir: (current: string): Promise<string | null> => ipcRenderer.invoke('dialog:chooseDir', current)
  },
  system: {
    displays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke('displays:list'),
    permissions: (): Promise<Permissions> => ipcRenderer.invoke('permissions:get'),
    requestPermission: (kind: PermissionKind): Promise<Permissions> => ipcRenderer.invoke('permissions:request', kind),
    openPrivacySettings: (kind: PermissionKind): Promise<void> => ipcRenderer.invoke('permissions:open', kind),
    openKeyboardShortcuts: (): Promise<void> => ipcRenderer.invoke('system:openKeyboardShortcuts'),
    version: (): Promise<string> => ipcRenderer.invoke('app:version'),
    platform: (): Promise<string> => ipcRenderer.invoke('app:platform'),
    relaunch: (): Promise<void> => ipcRenderer.invoke('app:relaunch'),
    suspendShortcuts: (suspended: boolean): Promise<void> => ipcRenderer.invoke('shortcuts:suspend', suspended),
    copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),
    loginItem: (): Promise<LoginItemStatus> => ipcRenderer.invoke('app:loginItem')
  },
  agents: {
    targets: (): Promise<AgentTargetStatus[]> => ipcRenderer.invoke('agents:targets'),
    install: (target: AgentTarget): Promise<AgentInstallResult> => ipcRenderer.invoke('agents:install', target),
    installInFile: (): Promise<AgentInstallResult | null> => ipcRenderer.invoke('agents:installInFile'),
    commands: (): Promise<McpCommands> => ipcRenderer.invoke('agents:commands')
  },
  whisper: {
    models: (): Promise<WhisperModelInfo[]> => ipcRenderer.invoke('whisper:models'),
    dir: (): Promise<string> => ipcRenderer.invoke('whisper:dir'),
    download: (id: WhisperModelId): Promise<void> => ipcRenderer.invoke('whisper:download', id),
    cancel: (id: WhisperModelId): Promise<void> => ipcRenderer.invoke('whisper:cancel', id),
    delete: (id: WhisperModelId): Promise<void> => ipcRenderer.invoke('whisper:delete', id),
    onProgress: (cb: (p: DownloadProgress) => void) => on<DownloadProgress>('whisper:progress', cb)
  },
  recording: {
    state: (): Promise<AppState> => ipcRenderer.invoke('recording:state'),
    start: (req: RecordingRequest): Promise<void> => ipcRenderer.invoke('recording:start', req),
    stop: (): Promise<void> => ipcRenderer.invoke('recording:stop'),
    reset: (): Promise<void> => ipcRenderer.invoke('recording:reset'),
    skipTranscription: (): Promise<void> => ipcRenderer.invoke('recording:skipTranscription'),
    onState: (cb: (s: AppState) => void) => on<AppState>('state', cb),
    /** Microphone level while recording, 0..1, for the widget */
    onLevel: (cb: (level: number) => void) => on<number>('recording:level', cb),
    /** Shape, corner or visibility of the webcam from now on (widget) */
    setWebcamLayout: (patch: Partial<WebcamLayout>) => ipcRenderer.send('recording:webcamLayout', patch),
    onNavigate: (cb: (page: string) => void) => on<string>('navigate', cb)
  },
  recordings: {
    list: (): Promise<RecordingEntry[]> => ipcRenderer.invoke('recordings:list'),
    showInFolder: (p: string): Promise<void> => ipcRenderer.invoke('recordings:showInFolder', p),
    open: (p: string): Promise<string> => ipcRenderer.invoke('recordings:open', p),
    rename: (dir: string, title: string): Promise<void> => ipcRenderer.invoke('recordings:rename', dir, title),
    /** What the trim view plays */
    media: (dir: string): Promise<RecordingMedia> => ipcRenderer.invoke('recordings:media', dir),
    /** The frame of the video at that instant, small, as a data URL; null when there is none */
    thumbnail: (dir: string, tMs: number): Promise<string | null> => ipcRenderer.invoke('recordings:thumbnail', dir, tMs),
    /** Keeps the part between the two instants; false when refused because a recording is in progress. Progress and result come as state */
    trim: (dir: string, fromMs: number, toMs: number): Promise<boolean> => ipcRenderer.invoke('recordings:trim', dir, fromMs, toMs),
    trash: (dir: string): Promise<void> => ipcRenderer.invoke('recordings:trash', dir)
  },
  mics: {
    report: (list: MicList) => ipcRenderer.send('mics:report', list)
  },
  /** Used by the widget, which grows upwards while its webcam menu is open */
  controls: {
    resize: (height: number) => ipcRenderer.send('controls:resize', height)
  },
  /** Used by the webcam bubble */
  webcam: {
    onLayout: (cb: (layout: WebcamLayout) => void) => on<WebcamLayout>('webcam:layout', cb)
  },
  region: {
    confirm: (displayId: number, rect: { x: number; y: number; width: number; height: number }) => ipcRenderer.send('region:confirm', { displayId, rect }),
    cancel: () => ipcRenderer.send('region:cancel')
  },
  /** Used only by the capture engine inside the main window */
  engine: {
    onStart: (cb: (cmd: EngineStartCommand) => void) => on<EngineStartCommand>('engine:start', cb),
    onStop: (cb: () => void) => on<void>('engine:stop', cb),
    started: (info: EngineStartedInfo) => ipcRenderer.send('engine:started', info),
    chunk: (buf: ArrayBuffer) => ipcRenderer.send('engine:chunk', buf),
    sideStarted: (kind: SideTrackKind, t0: number) => ipcRenderer.send('engine:sideStarted', kind, t0),
    sideChunk: (kind: SideTrackKind, buf: ArrayBuffer) => ipcRenderer.send('engine:sideChunk', kind, buf),
    level: (level: number) => ipcRenderer.send('engine:level', level),
    stopped: () => ipcRenderer.send('engine:stopped'),
    error: (message: string) => ipcRenderer.send('engine:error', message)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
