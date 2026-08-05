import type { LucideIcon } from 'lucide-react'
import { AlertCircle } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * The customer app's shared visual atoms. One design language everywhere:
 * soft 2xl radii, ring-based borders, layered shadows, and a restrained
 * motion vocabulary (fade-up entrances, shimmer skeletons — see global.css).
 * Chili stays reserved for allergen tags and danger, per the design system —
 * review states read citron, published/approved reads basil.
 */

export const inputClass =
  'min-h-touch w-full rounded-xl bg-white px-3.5 py-2.5 text-steel-900 shadow-xs ring-1 ring-salt-300 outline-none transition-all duration-150 placeholder:text-salt-500 hover:ring-salt-400 focus:bg-white focus:ring-2 focus:ring-ember-400'

export const primaryButtonClass =
  'inline-flex min-h-touch cursor-pointer items-center justify-center gap-2 rounded-xl bg-linear-to-b from-ember-500 to-ember-600 px-4 py-2.5 font-semibold text-white shadow-md shadow-ember-600/25 transition-all duration-150 hover:shadow-lg hover:shadow-ember-600/30 hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-500'

export const subtleButtonClass =
  'inline-flex min-h-touch cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-steel-700 shadow-xs ring-1 ring-salt-300 transition-all duration-150 hover:bg-salt-50 hover:ring-salt-400 hover:shadow-sm active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steel-500'

/** The one card surface. Interactive cards add `cardHoverClass` on top. */
export const cardClass = 'rounded-2xl bg-white shadow-sm ring-1 ring-salt-200'

export const cardHoverClass =
  'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-steel-900/5 hover:ring-salt-300'

export const thClass =
  'px-4 py-3 text-left text-xs font-semibold tracking-wide text-salt-600 uppercase'

export const tdClass = 'px-4 py-3 text-sm text-steel-900'

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2.5 rounded-xl bg-chili-50 px-4 py-3 text-sm text-chili-700 ring-1 ring-chili-200 ring-inset"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

const badgeTones: Record<string, { chip: string; dot: string }> = {
  active: { chip: 'bg-basil-50 text-basil-700 ring-basil-200', dot: 'bg-basil-500' },
  approved: { chip: 'bg-basil-50 text-basil-700 ring-basil-200', dot: 'bg-basil-500' },
  verified: { chip: 'bg-basil-50 text-basil-700 ring-basil-200', dot: 'bg-basil-500' },
  pending_review: { chip: 'bg-citron-50 text-citron-700 ring-citron-200', dot: 'bg-citron-400' },
  unpublished: { chip: 'bg-citron-50 text-citron-700 ring-citron-200', dot: 'bg-citron-400' },
  unverified: { chip: 'bg-citron-50 text-citron-700 ring-citron-200', dot: 'bg-citron-400' },
  draft: { chip: 'bg-salt-100 text-salt-700 ring-salt-300', dot: 'bg-salt-400' },
  rejected: { chip: 'bg-salt-100 text-salt-700 ring-salt-300', dot: 'bg-salt-400' },
  archived: { chip: 'bg-salt-100 text-salt-700 ring-salt-300', dot: 'bg-salt-400' },
  fork: { chip: 'bg-steel-50 text-steel-700 ring-steel-200', dot: 'bg-steel-400' },
}

export function Badge({ value, label }: { value: string; label?: string }) {
  const tone = badgeTones[value] ?? badgeTones.draft
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-semibold tracking-wide uppercase ring-1 ring-inset ${tone.chip}`}
    >
      <span className={`size-1.5 rounded-full ${tone.dot}`} aria-hidden />
      {label ?? value.replace('_', ' ')}
    </span>
  )
}

/** Wraps a wide table so the page body never scrolls horizontally. */
export function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className={`overflow-x-auto ${cardClass}`}>
      <table className="w-full min-w-[640px] divide-y divide-salt-200">{children}</table>
    </div>
  )
}

/** Shimmer placeholder. Size it with width/height classes. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />
}

/**
 * The empty-state pattern: an icon in a soft tile, a headline, one line of
 * guidance, and (optionally) the action that fixes it.
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className={`flex flex-col items-center gap-3 px-6 py-14 text-center ${cardClass}`}>
      <span className="flex size-14 items-center justify-center rounded-2xl bg-salt-100 text-salt-500 ring-1 ring-salt-200 ring-inset">
        <Icon className="size-7" aria-hidden />
      </span>
      <p className="font-semibold text-steel-900">{title}</p>
      {hint && <p className="max-w-sm text-sm text-salt-600">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

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

/**
 * Selectable pill for tag pickers (allergens, dietary). A checkbox in modern
 * clothes — `selectedClass` sets the tone so allergens can read chili while
 * dietary reads basil.
 */
export function TogglePill({
  selected,
  onToggle,
  selectedClass,
  children,
}: {
  selected: boolean
  onToggle: () => void
  selectedClass: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onToggle}
      className={`inline-flex min-h-touch cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium ring-1 transition-all duration-150 active:scale-[0.97] ${
        selected
          ? selectedClass
          : 'bg-white text-salt-600 ring-salt-300 hover:text-steel-800 hover:ring-salt-400'
      }`}
    >
      {children}
    </button>
  )
}

/** A titled section card — the editor and detail pages are built from these. */
export function SectionCard({
  icon: Icon,
  title,
  hint,
  children,
  actions,
}: {
  icon?: LucideIcon
  title: string
  hint?: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <section className={`${cardClass} p-5 tablet:p-6`}>
      <header className="mb-4 flex flex-wrap items-center gap-3">
        {Icon && (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-ember-50 text-ember-600 ring-1 ring-ember-100 ring-inset">
            <Icon className="size-4.5" aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-steel-900">{title}</h2>
          {hint && <p className="text-xs text-salt-600">{hint}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  )
}
