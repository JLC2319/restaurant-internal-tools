import type { ReactNode } from 'react'

/**
 * Segmented control — the modern working/active, active/archived toggle.
 * Options are ids + labels; the selected pill slides visually via layout.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T
  onChange: (next: T) => void
  options: { id: T; label: ReactNode }[]
  ariaLabel: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded-xl bg-salt-100 p-1 ring-1 ring-salt-200 ring-inset"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`inline-flex min-h-touch cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all duration-150 ${
            value === option.id
              ? 'bg-white text-steel-900 shadow-sm ring-1 ring-salt-300'
              : 'text-salt-600 hover:text-steel-800'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
