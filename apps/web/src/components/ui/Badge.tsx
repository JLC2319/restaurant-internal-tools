const badgeTones: Record<string, { chip: string; dot: string }> = {
  active: { chip: 'bg-basil-50 text-basil-700 ring-basil-200', dot: 'bg-basil-500' },
  approved: { chip: 'bg-basil-50 text-basil-700 ring-basil-200', dot: 'bg-basil-500' },
  published: { chip: 'bg-basil-50 text-basil-700 ring-basil-200', dot: 'bg-basil-500' },
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
