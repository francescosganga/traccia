interface Props {
  label: string
  hint?: string
  value: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}

export function Toggle({ label, hint, value, disabled, onChange }: Props) {
  return (
    <label className="toggle">
      <span className="text">
        <span>{label}</span>
        {hint && <span className="small dim">{hint}</span>}
      </span>
      <button type="button" className={`switch ${value ? 'on' : ''}`} role="switch" aria-checked={value} disabled={disabled} onClick={() => onChange(!value)} />
    </label>
  )
}
