import { describe, expect, it } from 'vitest'
import {
  canJoin,
  canMoveBoundary,
  checkParts,
  isEdited,
  joinParts,
  keptDuration,
  moveBoundary,
  moveParts,
  partAt,
  snapParts,
  snapToFrame,
  splitAt,
  toAxis,
  toSource,
  updateParts,
  wholeRecording,
  type EditPart
} from './edit-list'

// 10 s cut at 2 s and 6 s, the last part moved first: 6-10, 0-2, 2-6
const moved: EditPart[] = [
  { from: 6000, to: 10_000 },
  { from: 0, to: 2000 },
  { from: 2000, to: 6000 }
]

describe('edit list', () => {
  it('splits the part under the playhead, not too close to its ends', () => {
    const parts = splitAt(wholeRecording(10_000), 2500)!
    expect(parts).toEqual([
      { from: 0, to: 2500 },
      { from: 2500, to: 10_000 }
    ])
    expect(splitAt(parts, 2550)).toBeNull()
    expect(splitAt(parts, 9950)).toBeNull()
    // On the frames of a 30 fps video
    expect(splitAt(parts, 4010, (ms) => snapToFrame(ms, 30))![1]).toEqual({ from: 2500, to: 4000 })
  })

  it('maps the axis to the recording and back, with the parts in their order', () => {
    expect(partAt(moved, 0)).toBe(0)
    expect(partAt(moved, 4000)).toBe(1)
    expect(partAt(moved, 10_000)).toBe(2)
    expect(toSource(moved, 1000)).toBe(7000)
    expect(toSource(moved, 4500)).toBe(500)
    expect(toSource(moved, 10_000)).toBe(6000)
    expect(toAxis(moved, 7000)).toBe(1000)
    expect(toAxis(moved, 2000)).toBe(6000)
    // The end of the recording is the end of the part that holds it
    expect(toAxis(moved, 10_000)).toBe(4000)
  })

  it('removes, silences and changes the webcam of the parts chosen, and puts them back', () => {
    const cut = updateParts(moved, [1], { removed: true })
    expect(keptDuration(cut)).toBe(8000)
    const back = updateParts(cut, [1], { removed: false })
    expect(back).toEqual(moved)
    const cam = updateParts(moved, [0, 2], { webcam: { shape: 'circle', corner: 'top-left', visible: false } })
    expect(updateParts(cam, [0, 2], { webcam: undefined })).toEqual(moved)
  })

  it('joins parts that continue each other in the recording, keeping what the first had', () => {
    expect(canJoin(moved, [1, 2])).toBe(true)
    expect(canJoin(moved, [0, 1])).toBe(false)
    expect(canJoin(moved, [2])).toBe(false)
    const muted = updateParts(moved, [1], { muted: true })
    expect(joinParts(muted, [2, 1])).toEqual([
      { from: 6000, to: 10_000 },
      { from: 0, to: 6000, muted: true }
    ])
    expect(joinParts(moved, [0, 1])).toBe(moved)
  })

  it('moves parts before another one or to the end', () => {
    expect(moveParts(moved, [1, 2], 0)).toEqual({ parts: [moved[1], moved[2], moved[0]], indices: [0, 1] })
    expect(moveParts(moved, [0], 3)).toEqual({ parts: [moved[1], moved[2], moved[0]], indices: [2] })
    expect(moveParts(moved, [0], 2)).toEqual({ parts: [moved[1], moved[0], moved[2]], indices: [1] })
    expect(moveParts(moved, [1], 1).parts).toEqual(moved)
  })

  it('drags a boundary between parts that continue each other, keeping both long enough', () => {
    expect(canMoveBoundary(moved, 0)).toBe(false)
    expect(canMoveBoundary(moved, 1)).toBe(true)
    expect(moveBoundary(moved, 0, 5000)).toBeNull()
    // The boundary is at 6000 on the axis (2000 of the recording)
    expect(moveBoundary(moved, 1, 5500)!.slice(1)).toEqual([
      { from: 0, to: 1500 },
      { from: 1500, to: 6000 }
    ])
    expect(moveBoundary(moved, 1, 0)![1]).toEqual({ from: 0, to: 100 })
    expect(moveBoundary(moved, 1, 99_999)![2]).toEqual({ from: 5900, to: 6000 })
  })

  it('puts the cuts on the frames of a video, leaving the end of the recording', () => {
    const parts: EditPart[] = [
      { from: 6010, to: 10_010 },
      { from: 0, to: 2020, removed: true },
      { from: 2020, to: 2030 },
      { from: 2030, to: 6010 }
    ]
    expect(snapParts(parts, 30, 10_010)).toEqual([
      { from: 6000, to: 10_010 },
      { from: 0, to: 2033, removed: true },
      { from: 2033, to: 6000 }
    ])
  })

  it('tells whether there is something to save', () => {
    expect(isEdited(wholeRecording(10_000))).toBe(false)
    expect(isEdited(splitAt(wholeRecording(10_000), 5000)!)).toBe(false)
    expect(isEdited(moved)).toBe(true)
    expect(isEdited(updateParts(wholeRecording(10_000), [0], { muted: true }))).toBe(true)
  })

  it('accepts only parts that cover the recording once and leave something to save', () => {
    expect(checkParts(moved, 10_000)).toEqual(moved)
    expect(() => checkParts(moved, 12_000)).toThrow(RangeError)
    expect(() => checkParts([{ from: 0, to: 5000 }, { from: 4000, to: 10_000, removed: true }], 10_000)).toThrow(RangeError)
    expect(() => checkParts([{ from: 0, to: 500 }, { from: 500, to: 10_000, removed: true }], 10_000)).toThrow(RangeError)
    expect(() => checkParts(wholeRecording(10_000), 10_000)).toThrow(RangeError)
    expect(() => checkParts([{ from: 0, to: 10_000, webcam: { shape: 'star', corner: 'top-left', visible: true } }], 10_000)).toThrow(RangeError)
    expect(() => checkParts([{ from: 0, to: 5000.5 }, { from: 5000.5, to: 10_000, removed: true }], 10_000)).toThrow(RangeError)
  })
})
