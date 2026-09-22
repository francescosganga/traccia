import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

export interface MenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
}

interface Props {
  items: MenuItem[]
  /** Accessible name of the trigger button */
  label: string
}

/** Overflow menu behind a "…" button: the secondary actions of a row, so the row keeps one or two visible ones. */
export function Menu({ items, label }: Props) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = () => {
    // Open upwards when the list would run past the bottom of the window
    const rect = ref.current?.getBoundingClientRect()
    setUp(!!rect && rect.bottom + items.length * 32 + 16 > window.innerHeight)
    setOpen((o) => !o)
  }

  return (
    <div className="menu" ref={ref}>
      <button type="button" className="btn ghost icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        <Icon name="more" />
      </button>
      {open && (
        <div className={`menu-list ${up ? 'up' : ''}`} role="menu">
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              className={`menu-item ${item.danger ? 'danger' : ''}`}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
