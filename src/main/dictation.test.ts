import { mkdtempSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activities } from './activity'
import { DictationSession } from './dictation'

type Handler = (...args: never[]) => unknown
const mocks = vi.hoisted(() => ({
  root: '', handlers: new Map<string, Handler>(), events: new Map<string, Handler>(),
  sender: { send: vi.fn() }, capture: vi.fn(), insert: vi.fn(), transcribe: vi.fn(), kill: vi.fn(), model: vi.fn(),
  microphone: 'granted', copy: vi.fn(), show: vi.fn(), hide: vi.fn(), ffmpeg: vi.fn(), sent: vi.fn()
}))
vi.mock('electron', () => ({
  app: { getPath: () => mocks.root, dock: { show: vi.fn() } },
  BrowserWindow: class {
    webContents = { ...mocks.sender, on: vi.fn(), setWindowOpenHandler: vi.fn() }
    constructor() { mocks.sender = this.webContents }
    isDestroyed() { return false }
    on = vi.fn()
    setAlwaysOnTop = vi.fn()
    setVisibleOnAllWorkspaces = vi.fn()
    getSize = () => [440, 650]
    setSize = vi.fn()
    show = mocks.show
    showInactive = mocks.show
    setBounds = vi.fn()
    hide = mocks.hide
    destroy = vi.fn()
    loadFile = vi.fn().mockResolvedValue(undefined)
  },
  screen: { getAllDisplays: () => [], getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1200, height: 800 } }) },
  nativeTheme: { shouldUseDarkColors: false },
  clipboard: { writeText: mocks.copy },
  powerMonitor: { on: vi.fn() },
  ipcMain: { handle: (name: string, fn: Handler) => mocks.handlers.set(name, fn), on: (name: string, fn: Handler) => mocks.events.set(name, fn) }
}))
vi.mock('./windows', () => ({ broadcast: mocks.sent }))
vi.mock('./text-insertion', () => ({ TextInsertion: class { capture = mocks.capture; insert = mocks.insert; close = vi.fn() } }))
vi.mock('./permissions', () => ({ getPermissions: () => ({ microphone: mocks.microphone }) }))
vi.mock('./settings', () => ({ getSettings: () => ({ dictationModel: 'base', dictationMic: null, dictationLanguage: 'it', showInDock: false }) }))
vi.mock('./whisper', () => ({ isModelInstalled: mocks.model, transcribe: mocks.transcribe, killWorker: mocks.kill }))
vi.mock('./ffmpeg', () => ({ runFfmpeg: mocks.ffmpeg }))

let session: DictationSession
const invoke = (name: string, ...args: unknown[]) => mocks.handlers.get(name)!({ sender: mocks.sender } as never, ...args as never[])
const event = (name: string, ...args: unknown[]) => mocks.events.get(name)!({ sender: mocks.sender } as never, ...args as never[])
const id = () => mocks.sender.send.mock.calls.slice().reverse().find((call) => call[0] === 'dictation:capture')![1].id as number

beforeEach(() => {
  vi.clearAllMocks()
  mocks.sent.mockReset()
  mocks.root = mkdtempSync(join(tmpdir(), 'traccia-dictation-test-'))
  mocks.microphone = 'granted'
  mocks.model.mockReturnValue(true)
  mocks.capture.mockResolvedValue({ name: 'Editor', token: 'destination' })
  mocks.insert.mockResolvedValue(true)
  mocks.ffmpeg.mockResolvedValue('')
  mocks.transcribe.mockResolvedValue({ segments: [{ text: 'Testo locale.' }], words: [] })
  session = new DictationSession(() => {})
  session.registerIpc()
})
afterEach(async () => { await session.cancel(); session.dispose(); await rm(mocks.root, { recursive: true, force: true }) })

describe('dictation session', () => {
  it('acquires exclusive ownership before resolving the destination', async () => {
    let resolve!: (value: unknown) => void
    mocks.capture.mockReturnValue(new Promise((r) => { resolve = r }))
    const opening = session.open()
    expect(activities.current).toBe('dictation')
    expect(activities.acquire('recording')).toBeNull()
    await session.cancel()
    resolve({ name: 'Late', token: 'late' })
    await opening
    expect(mocks.show).not.toHaveBeenCalled()
    expect(session.state.target).toBeNull()
    expect(activities.current).toBeNull()
  })

  it('does not listen or reserve resources when a model is missing', async () => {
    mocks.model.mockReturnValue(false)
    await session.open()
    expect(session.state.phase).toBe('ready')
    expect(activities.current).toBeNull()
    expect(mocks.sender.send).not.toHaveBeenCalledWith('dictation:capture', expect.anything())
  })

  it('a busy recording prevents dictation without cancelling its work', async () => {
    const release = activities.acquire('recording')!
    try {
      await session.open()
      expect(mocks.capture).not.toHaveBeenCalled()
      expect(mocks.kill).not.toHaveBeenCalled()
      expect(activities.current).toBe('recording')
    } finally { release() }
  })

  it('inserts flushed audio automatically and captures a fresh target for the next take', async () => {
    await session.open()
    const take = id()
    event('dictation:started', take, { fallback: false, callQuality: false, micName: 'Mic' })
    await invoke('dictation:chunk', take, new ArrayBuffer(4))
    session.stop()
    await invoke('dictation:stopped', take, false)
    expect(session.state.text).toBe('Testo locale.')
    expect(activities.current).toBeNull()
    expect(mocks.insert).toHaveBeenCalledWith('destination', 'Testo locale.', true)
    expect(session.state.phase).toBe('done')
    expect(mocks.sent.mock.calls.filter(([name]) => name === 'dictation:state').map(([, state]) => state.phase)).not.toContain('result')
    await session.open()
    expect(session.state.text).toBe('')
    expect(session.state.phase).toBe('preparing')
    expect(mocks.capture).toHaveBeenCalledTimes(2)
  })

  it('keeps audio retryable on inference failure without reserving the worker', async () => {
    mocks.transcribe.mockRejectedValueOnce(new Error('inference failed'))
    await session.open()
    const take = id()
    event('dictation:started', take, { fallback: false, callQuality: false, micName: 'Mic' })
    await invoke('dictation:chunk', take, new ArrayBuffer(4))
    await invoke('dictation:stopped', take, false)
    expect(session.state.retry).toBe(true)
    expect(activities.current).toBeNull()
    await session.retry()
    expect(session.state.text).toBe('Testo locale.')
    expect(session.state.retry).toBe(false)
  })

  it('ignores late recorder errors after delivery and starts the next take', async () => {
    await session.open()
    const take = id()
    event('dictation:started', take, { fallback: false, callQuality: false, micName: 'Mic' })
    await invoke('dictation:stopped', take, false)
    event('dictation:error', take)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(session.state.phase).toBe('done')
    await session.open()
    expect(session.state.phase).toBe('preparing')
    expect(id()).not.toBe(take)
  })

  it('releases dictation ownership even if the insertion UI throws before dispatch', async () => {
    await session.open()
    const take = id()
    event('dictation:started', take, { fallback: false, callQuality: false, micName: 'Mic' })
    mocks.sent.mockImplementation((name, state) => {
      if (name === 'dictation:state' && state.phase === 'inserting') throw new Error('window unavailable')
    })
    await invoke('dictation:stopped', take, false)
    expect(activities.current).toBeNull()
    mocks.sent.mockReset()
    await session.start(true)
    expect(session.state.phase).toBe('preparing')
  })

  it('does not reopen delivered text after a temporary competing activity finishes', async () => {
    await session.open()
    const take = id()
    event('dictation:started', take, { fallback: false, callQuality: false, micName: 'Mic' })
    await invoke('dictation:stopped', take, false)
    const release = activities.acquire('models')!
    try {
      await session.open()
      expect(session.state.phase).toBe('error')
      expect(session.state.text).toBe('')
      expect(activities.current).toBe('models')
    } finally { release() }
    await session.open()
    expect(session.state.phase).toBe('preparing')
    expect(mocks.capture).toHaveBeenCalledTimes(2)
  })

  it('consumes a recorder stop only once even while the file is still flushing', async () => {
    await session.open()
    const take = id()
    event('dictation:started', take, { fallback: false, callQuality: false, micName: 'Mic' })
    await invoke('dictation:chunk', take, new ArrayBuffer(4))
    await Promise.all([invoke('dictation:stopped', take, false), invoke('dictation:stopped', take, false)])
    expect(mocks.transcribe).toHaveBeenCalledOnce()
    expect(mocks.insert).toHaveBeenCalledOnce()
    expect(session.state.phase).toBe('done')
    expect(activities.current).toBeNull()
  })

  it('ignores the result of a cancelled transcription', async () => {
    let resolve!: (value: unknown) => void
    mocks.transcribe.mockReturnValue(new Promise((r) => { resolve = r }))
    await session.open()
    const take = id()
    event('dictation:started', take, { fallback: false, callQuality: false, micName: 'Mic' })
    const stopped = invoke('dictation:stopped', take, false)
    await vi.waitFor(() => expect(mocks.transcribe).toHaveBeenCalled())
    await session.cancel()
    resolve({ segments: [{ text: 'Obsoleto' }], words: [] })
    await stopped
    expect(session.state.text).toBe('')
    expect(session.state.phase).toBe('ready')
  })

  it('inserts the edited preview only once and keeps it for recovery', async () => {
    mocks.model.mockReturnValue(false)
    await session.open()
    await invoke('dictation:action', 'insert', 'Testo corretto.')
    expect(mocks.insert).toHaveBeenCalledWith('destination', 'Testo corretto.', false)
    await session.insert()
    expect(mocks.insert).toHaveBeenCalledOnce()
    expect(session.state.text).toBe('Testo corretto.')
    expect(session.state.target?.token).toBeUndefined()
  })

  it('never inserts old text when a new take contains no recognized speech', async () => {
    session.state.text = 'Vecchio testo'
    mocks.transcribe.mockResolvedValue({ segments: [], words: [] })
    await session.start(true)
    const take = id()
    event('dictation:started', take, { fallback: false, callQuality: false, micName: 'Mic' })
    await invoke('dictation:stopped', take, false)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(session.state.text).toBe('')
  })

  it('discards an empty take without starting Whisper', async () => {
    await session.open()
    const take = id()
    event('dictation:started', take, { fallback: false, callQuality: false, micName: 'Mic' })
    event('dictation:empty', take)
    await vi.waitFor(() => expect(activities.current).toBeNull())
    expect(mocks.transcribe).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.hide).toHaveBeenCalled()
  })

  it('keeps a failed automatic insertion editable and never retries it on reopen', async () => {
    mocks.insert.mockResolvedValue(false)
    await session.open()
    const take = id()
    event('dictation:started', take, { fallback: false, callQuality: false, micName: 'Mic' })
    await invoke('dictation:stopped', take, false)
    expect(session.state.phase).toBe('result')
    await invoke('dictation:action', 'text', 'Testo rivisto')
    await session.closePanel()
    await session.open()
    expect(session.state.text).toBe('Testo rivisto')
    expect(mocks.insert).toHaveBeenCalledOnce()
  })

  it('keeps Copy usable without Accessibility', async () => {
    mocks.model.mockReturnValue(false)
    mocks.capture.mockResolvedValue({ name: 'Editor', reason: 'permission' })
    await session.open()
    await invoke('dictation:action', 'copy', 'Da incollare manualmente.')
    expect(mocks.copy).toHaveBeenCalledWith('Da incollare manualmente.')
    await session.insert()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('does not paste while another activity owns the app', async () => {
    mocks.model.mockReturnValue(false)
    await session.open()
    const release = activities.acquire('recording')!
    try {
      await invoke('dictation:action', 'insert', 'Anteprima conservata.')
      expect(mocks.insert).not.toHaveBeenCalled()
      expect(session.state.text).toBe('Anteprima conservata.')
      expect(session.state.target?.token).toBe('destination')
      expect(activities.current).toBe('recording')
    } finally { release() }
  })

  it('restores the preview and releases ownership if insertion throws', async () => {
    mocks.model.mockReturnValue(false)
    mocks.insert.mockRejectedValueOnce(new Error('helper failed'))
    await session.open()
    await invoke('dictation:action', 'insert', 'Testo da recuperare.')
    expect(session.state.phase).toBe('result')
    expect(session.state.text).toBe('Testo da recuperare.')
    expect(session.state.target?.token).toBeUndefined()
    expect(activities.current).toBeNull()
    expect(mocks.show).toHaveBeenCalledTimes(2)
  })

  it('keeps the panel visible until the destination has received the paste command', async () => {
    mocks.model.mockReturnValue(false)
    let resolve!: (sent: boolean) => void
    mocks.insert.mockReturnValueOnce(new Promise<boolean>((done) => { resolve = done }))
    await session.open()
    const inserting = invoke('dictation:action', 'insert', 'Passaggio del focus.')
    expect(session.state.phase).toBe('inserting')
    expect(mocks.hide).not.toHaveBeenCalled()
    resolve(true)
    await inserting
    expect(session.state.phase).toBe('done')
    await vi.waitFor(() => expect(mocks.hide).toHaveBeenCalledOnce())
  })
})
