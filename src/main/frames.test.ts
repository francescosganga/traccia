import { describe, expect, it, vi } from 'vitest'
import { computeKeepMask } from './frames'
import type { Geometry } from './timeline'

// frames.ts imports ./ffmpeg, which imports electron; neither is needed here.
vi.mock('./ffmpeg', () => ({ runFfmpeg: vi.fn() }))

const W = 480 // THUMB_WIDTH in frames.ts
const H = 2
const FRAME_MS = 500

// Output at twice the thumbnail width, so a pointer at output x lands at x / 2 in the thumbnail.
const geometry: Geometry = {
  displayBounds: { x: 0, y: 0, width: 960, height: 4 },
  scale: 1,
  cropPx: { x: 0, y: 0, width: 960, height: 4 },
  outScale: 1,
  outWidth: 960,
  outHeight: 4
}
const noCursor = { geometry, samples: [], t0: 0 }

/** Paints pixels [from, to) of the first thumbnail row of `frame`. */
function paint(buf: Buffer, frame: number, from: number, to: number, value = 255): void {
  for (let x = from; x < to; x++) buf[frame * W * H + x] = value
}

describe('computeKeepMask', () => {
  it('keeps a frame when at least 8 pixels differ from the last kept one', () => {
    const buf = Buffer.alloc(W * H * 4)
    paint(buf, 1, 0, 5)
    paint(buf, 2, 10, 15) // 10 pixels away from frame 1, but only 5 from the kept frame 0
    paint(buf, 3, 0, 8)
    expect(computeKeepMask(buf, 4, noCursor, FRAME_MS)).toEqual([true, false, false, true])
  })

  it('ignores differences of at most 28 gray levels', () => {
    const buf = Buffer.alloc(W * H * 3)
    paint(buf, 1, 0, 100, 28)
    paint(buf, 2, 0, 100, 29)
    expect(computeKeepMask(buf, 3, noCursor, FRAME_MS)).toEqual([true, false, true])
  })

  it('ignores changes within 14 pixels of the pointer in either frame', () => {
    const samples = [
      { t: 0, x: 400, y: 0 },
      { t: FRAME_MS, x: 600, y: 0 }
    ]
    const buf = Buffer.alloc(W * H * 3)
    paint(buf, 1, 190, 198) // around the pointer of the kept frame (thumbnail x 200)
    paint(buf, 1, 290, 298) // around the pointer of this frame (thumbnail x 300)
    paint(buf, 2, 100, 108)
    expect(computeKeepMask(buf, 3, { geometry, samples, t0: 0 }, FRAME_MS)).toEqual([true, false, true])
  })

  it('rejects a buffer that does not hold whole thumbnails', () => {
    expect(() => computeKeepMask(Buffer.alloc(100), 3, noCursor, FRAME_MS)).toThrow(/thumbnail buffer size/)
    expect(() => computeKeepMask(Buffer.alloc(W * H * 3 + 1), 3, noCursor, FRAME_MS)).toThrow(/thumbnail buffer size/)
  })
})
