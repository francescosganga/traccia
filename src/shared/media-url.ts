// URLs the main window loads recordings from: its CSP allows no file:// (see main/media-protocol.ts).
// No Node imports: the renderer builds the URLs, the main process reads them back.

export const MEDIA_SCHEME = 'traccia-media'
const HOST = 'local'

/** URL of a file of a recording, from its absolute path. */
export function mediaUrl(path: string): string {
  return `${MEDIA_SCHEME}://${HOST}${path.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * The absolute path a media URL points to, or null unless it is a file inside `root` (an absolute
 * path without a trailing slash). Each segment is decoded on its own and must be a plain name:
 * the URL parser resolves "..", but an encoded "%2F.." would otherwise become one after decoding.
 */
export function mediaPath(url: string, root: string): string | null {
  let segments: string[]
  try {
    const u = new URL(url)
    if (u.protocol !== `${MEDIA_SCHEME}:` || u.host !== HOST) return null
    segments = u.pathname.split('/').slice(1).map(decodeURIComponent)
  } catch {
    return null
  }
  if (segments.some((s) => s === '' || s === '.' || s === '..' || /[/\\\0]/.test(s))) return null
  const path = '/' + segments.join('/')
  return path.startsWith(root + '/') ? path : null
}
