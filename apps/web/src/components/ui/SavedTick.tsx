import { Check } from 'lucide-react'

/** The quiet "Saved" confirmation that follows a successful settings write. */
export function SavedTick({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-basil-600">
      <Check className="size-4" aria-hidden />
      Saved
    </span>
  )
}
