import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { webcamRadius, type WebcamShape } from '../../shared/webcam'
import { openCamera } from './media'

/** The webcam bubble shown while recording: the camera, mirrored like a mirror, in the shape it will have in the video. */
function Bubble() {
  const video = useRef<HTMLVideoElement>(null)
  const [shape] = useState(() => (new URLSearchParams(location.search).get('shape') ?? 'square') as WebcamShape)

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    window.api.settings
      .get()
      .then((s) => openCamera(s.webcamDevice))
      .then((s) => {
        stream = s
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        if (video.current) video.current.srcObject = s
      })
      .catch((e) => console.error('webcam bubble: cannot open the camera', e))
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return <video ref={video} className="webcam-bubble" style={{ borderRadius: webcamRadius(shape, window.innerHeight) }} autoPlay muted playsInline />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Bubble />
  </StrictMode>
)
