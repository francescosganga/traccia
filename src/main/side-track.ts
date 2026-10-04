import { createWriteStream, type WriteStream } from 'fs'
import { rm, stat } from 'fs/promises'

/**
 * A track recorded beside the screen by its own MediaRecorder (the webcam), written to its
 * own file. Its recorder starts a few ms apart from the screen's: `t0` lines them up when
 * the video is put together.
 */
export class SideTrack {
  path = ''
  /** Epoch ms of its recorder's start, null until it starts */
  t0: number | null = null
  private file: WriteStream | null = null

  open(path: string): void {
    this.close()
    this.path = path
    this.t0 = null
    this.file = createWriteStream(path)
  }

  /** Not recorded this time. */
  clear(): void {
    this.close()
    this.path = ''
    this.t0 = null
  }

  write(chunk: ArrayBuffer | Buffer): void {
    this.file?.write(Buffer.from(chunk as ArrayBuffer))
  }

  /** Flushes and closes the file (end of the recording). */
  end(): Promise<void> {
    const file = this.file
    this.file = null
    return new Promise((resolve) => (file ? file.end(resolve) : resolve()))
  }

  /** Closes the file without waiting (aborted recording). */
  close(): void {
    this.file?.close()
    this.file = null
  }

  /** Its recorder started and wrote something. */
  async recorded(): Promise<boolean> {
    if (this.t0 === null || !this.path) return false
    return stat(this.path).then(
      (s) => s.size > 0,
      () => false
    )
  }

  /** Seconds to add to its timestamps to put it on the clock of the screen that started at `screenT0`. */
  offset(screenT0: number): number {
    return ((this.t0 ?? screenT0) - screenT0) / 1000
  }

  async remove(): Promise<void> {
    if (this.path) await rm(this.path, { force: true })
  }
}
