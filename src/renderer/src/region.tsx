import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { setLanguage, t } from '../../shared/i18n'

type Pt = { x: number; y: number }
const MIN_SIZE = 20
const displayId = Number(new URLSearchParams(location.search).get('displayId'))

function RegionSelector() {
  const [start, setStart] = useState<Pt | null>(null)
  const [end, setEnd] = useState<Pt | null>(null)
  const [dragging, setDragging] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void window.api.settings.get().then((s) => {
      setLanguage(s.uiLanguage)
      setReady(true)
    })
  }, [])

  const rect = start && end
    ? { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }
    : null
  const valid = !!rect && rect.width >= MIN_SIZE && rect.height >= MIN_SIZE

  const confirm = () => {
    if (rect && valid) window.api.region.confirm(displayId, rect)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.api.region.cancel()
      if (e.key === 'Enter') confirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.region-toolbar')) return
    setStart({ x: e.clientX, y: e.clientY })
    setEnd({ x: e.clientX, y: e.clientY })
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging) setEnd({ x: e.clientX, y: e.clientY })
  }
  const onPointerUp = () => setDragging(false)

  const toolbarBelow = rect ? rect.y + rect.height + 52 < window.innerHeight : true
  if (!ready) return null

  return (
    <div className="region-root" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      {!rect && <div className="region-hint">{t('region.hint')}</div>}
      {rect && (
        <div className="region-rect" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
          <div className="region-size">
            {rect.width} × {rect.height}
          </div>
          {!dragging && valid && (
            <div
              className="region-toolbar"
              style={{ left: 0, top: toolbarBelow ? rect.height + 10 : -54 }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button className="btn primary record" onClick={confirm}>
                {t('common.record')}
              </button>
              <button className="btn" onClick={() => window.api.region.cancel()}>
                {t('common.cancel')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RegionSelector />
  </StrictMode>
)
