import { describe, expect, it } from 'vitest'
import { placeLayout, webcamGraph } from './compose'
import { compactLayout, webcamRect } from '../shared/webcam'

describe('webcamRect', () => {
  it('puts the webcam at the chosen corner, sized on the shorter side', () => {
    expect(webcamRect('square', 'bottom-right', 1920, 1080)).toEqual({ x: 1608, y: 768, width: 280, height: 280 })
    expect(webcamRect('circle', 'top-left', 1920, 1080)).toEqual({ x: 32, y: 32, width: 280, height: 280 })
    expect(webcamRect('rectangle', 'top-right', 1920, 1080)).toEqual({ x: 1390, y: 32, width: 498, height: 280 })
  })

  it('narrows the rectangle to fit a tall region', () => {
    const r = webcamRect('rectangle', 'bottom-left', 300, 900)
    expect(r.x + r.width).toBeLessThanOrEqual(300 - r.x)
  })
})

describe('compactLayout', () => {
  it('drops changes that change nothing and keeps the last of simultaneous ones', () => {
    const square = { shape: 'square', corner: 'bottom-right', visible: true } as const
    expect(
      compactLayout([
        { t: 0, ...square },
        { t: 0, ...square, corner: 'top-left' },
        { t: 500, ...square, corner: 'top-left' },
        { t: 900, ...square, visible: false }
      ])
    ).toEqual([
      { t: 0, ...square, corner: 'top-left' },
      { t: 900, ...square, visible: false }
    ])
  })
})

describe('webcamGraph', () => {
  const base = { screenFilters: [], width: 1920, height: 1080, durationMs: 10_000 }

  it('overlays a single layout for the whole recording', () => {
    const graph = webcamGraph({ ...base, layout: [{ t: 0, shape: 'circle', corner: 'bottom-right', visible: true }] })
    expect(graph).toContain('[0:v]null[base]')
    expect(graph).toContain('[1:v]trim=end=10.000[c0]')
    expect(graph).toContain('scale=280:280')
    expect(graph).toContain("[base][w0]overlay=x='1608':y='768':enable='gte(t,0.000)':eval=frame[vout]")
  })

  it('gives each shape one branch and moves it between corners over time', () => {
    const graph = webcamGraph({
      ...base,
      screenFilters: ['crop=100:100:0:0'],
      layout: [
        { t: 0, shape: 'square', corner: 'bottom-right', visible: true },
        { t: 2000, shape: 'square', corner: 'top-left', visible: true },
        { t: 4000, shape: 'rectangle', corner: 'top-left', visible: true },
        { t: 6000, shape: 'rectangle', corner: 'top-left', visible: false }
      ]
    })!
    expect(graph).toContain('[0:v]crop=100:100:0:0[base]')
    expect(graph).toContain('split=2[c0][c1]')
    expect(graph).toContain("overlay=x='if(lt(t,2.000),1608,32)':y='if(lt(t,2.000),768,32)':enable='between(t,0.000,2.000)+between(t,2.000,4.000)':eval=frame[v0]")
    expect(graph).toContain("[v0][w1]overlay=x='32':y='32':enable='between(t,4.000,6.000)':eval=frame[vout]")
  })

  it('returns null when the webcam is never shown', () => {
    expect(webcamGraph({ ...base, layout: [{ t: 0, shape: 'circle', corner: 'top-left', visible: false }] })).toBeNull()
  })

  it('places every change for the timeline and recording.json', () => {
    expect(placeLayout([{ t: 0, shape: 'square', corner: 'top-left', visible: true }], 1920, 1080)[0].rect).toEqual({ x: 32, y: 32, width: 280, height: 280 })
  })
})
