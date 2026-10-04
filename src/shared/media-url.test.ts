import { describe, expect, it } from 'vitest'
import { mediaPath, mediaUrl } from './media-url'

const root = '/Users/me/Movies/Traccia'

describe('media URLs', () => {
  it('give back the path of a file in the recordings folder', () => {
    const path = `${root}/2026-10-01_10-00-00/frames/frame_00001.jpg`
    expect(mediaPath(mediaUrl(path), root)).toBe(path)
    const odd = `${root}/Demo #1 ? 100%/recording.mp4`
    expect(mediaPath(mediaUrl(odd), root)).toBe(odd)
  })

  it('refuse anything outside it', () => {
    expect(mediaPath(mediaUrl('/etc/passwd'), root)).toBeNull()
    expect(mediaPath(mediaUrl(root), root)).toBeNull()
    expect(mediaPath(mediaUrl('/Users/me/Movies/Traccia-other/x.mp4'), root)).toBeNull()
    // ".." resolved by the URL parser, or hidden behind an encoded slash
    expect(mediaPath(`traccia-media://local${root}/../../../etc/passwd`, root)).toBeNull()
    expect(mediaPath(`traccia-media://local${root}/a%2F..%2F..%2F..%2Fetc/passwd`, root)).toBeNull()
    expect(mediaPath(`traccia-media://local${root}/%2E%2E/%2E%2E/secret`, root)).toBeNull()
    expect(mediaPath(`traccia-media://local${root}/a%00.mp4`, root)).toBeNull()
    expect(mediaPath(`traccia-media://local${root}/%E0%A4%A`, root)).toBeNull()
    expect(mediaPath(`file://${root}/a.mp4`, root)).toBeNull()
    expect(mediaPath(`traccia-media://elsewhere${root}/a.mp4`, root)).toBeNull()
  })
})
