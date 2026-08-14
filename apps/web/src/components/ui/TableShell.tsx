import type { ReactNode } from 'react'
import { cardClass } from './tokens'

/** Wraps a wide table so the page body never scrolls horizontally. */
export function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className={`overflow-x-auto ${cardClass}`}>
      <table className="w-full min-w-[640px] divide-y divide-salt-200">{children}</table>
    </div>
  )
}
