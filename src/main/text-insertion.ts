import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createInterface } from 'readline'
import { join } from 'path'
import type { DictationTarget } from '../shared/dictation'

interface Reply { id: number; ok: boolean; name?: string; token?: string; reason?: string }
type Pending = { resolve: (reply: Reply) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }

export class TextInsertion {
  private child: ChildProcessWithoutNullStreams | null = null
  private sequence = 0
  private pending = new Map<number, Pending>()

  private start(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child
    const path = app.isPackaged ? join(process.resourcesPath, 'native/text-insertion') : join(__dirname, '../native/text-insertion')
    const child = spawn(path, [String(process.pid)], { stdio: 'pipe' })
    this.child = child
    createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        const reply = JSON.parse(line) as Reply
        const pending = this.pending.get(reply.id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(reply.id)
        pending.resolve(reply)
      } catch (error) { console.error('text insertion: invalid helper response', error) }
    })
    child.stderr.on('data', (data) => console.error('text insertion helper:', data.toString()))
    const failed = () => {
      if (this.child !== child) return
      this.close()
    }
    child.on('error', (error) => { console.error('text insertion helper failed', error); failed() })
    child.on('exit', failed)
    child.stdin.on('error', failed)
    return child
  }

  private request(command: string, fields: Record<string, string> = {}): Promise<Reply> {
    if (process.platform !== 'darwin') return Promise.reject(new Error('macOS required'))
    const child = this.start()
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(), 3000)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(JSON.stringify({ id, command, ...fields }) + '\n')
    })
  }

  async capture(): Promise<DictationTarget> {
    try {
      const reply = await this.request('capture')
      return { name: reply.name ?? '', token: reply.ok ? reply.token : undefined, reason: reply.ok ? undefined : reply.reason === 'permission' ? 'permission' : 'destination' }
    } catch (error) {
      console.error('cannot capture dictation destination', error)
      return { name: '', reason: 'unavailable' }
    }
  }

  async insert(token: string, text: string, automatic = false): Promise<boolean> {
    try { return (await this.request('insert', { token, text, automatic: String(automatic) })).ok }
    catch (error) { console.error('cannot insert dictation', error); return false }
  }

  close(): void {
    const child = this.child
    this.child = null
    child?.kill()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('text insertion helper unavailable'))
    }
    this.pending.clear()
  }
}
