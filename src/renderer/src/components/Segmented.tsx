export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string; disabled?: boolean }[]
  onChange: (v: T) => void
}): React.JSX.Element {
  return (
    <div className="segmented" data-nodrag>
      {options.map((o) => (
        <button
          key={o.value}
          className={o.value === value ? 'active' : ''}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
