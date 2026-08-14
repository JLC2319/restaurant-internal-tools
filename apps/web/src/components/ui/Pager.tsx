import { ChevronLeft, ChevronRight } from 'lucide-react'
import { subtleButtonClass } from './tokens'

/**
 * The pagination row: previous/next around a "Page x of y" label. Renders
 * nothing for a single page, so callers can mount it unconditionally.
 */
export function Pager({
  page,
  totalPages,
  onPage,
}: {
  page: number
  totalPages: number
  onPage: (next: number) => void
}) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-center gap-3 pt-2">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className={subtleButtonClass}
      >
        <ChevronLeft className="size-4" aria-hidden />
        Previous
      </button>
      <span className="text-sm text-salt-600">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        className={subtleButtonClass}
      >
        Next
        <ChevronRight className="size-4" aria-hidden />
      </button>
    </div>
  )
}
