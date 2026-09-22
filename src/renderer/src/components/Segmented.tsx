interface Option<T> {
  id: T
  label: string
}

interface Props<T extends string | number> {
  options: Option<T>[]
  value: T
  onChange: (value: T) => void
}

/** One-of-N choice; the pressed segment is exposed to assistive tech with aria-pressed. */
export function Segmented<T extends string | number>({ options, value, onChange }: Props<T>) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button key={String(o.id)} type="button" className={value === o.id ? 'active' : ''} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
