import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cardClass } from './tokens'

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
