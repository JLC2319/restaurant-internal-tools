import { useQuery } from '@tanstack/react-query'
import type { MembershipSummary } from '@rit/shared'
import { UserRound } from 'lucide-react'
import { getMyMemberships } from '../api/auth'
import { getScope, setScope, clearAuth } from '../api/client'
import { QueryProvider } from './QueryProvider'

function label(m: MembershipSummary): string {
  if (m.location) return `${m.org.name} › ${m.property?.name} › ${m.location.name}`
  if (m.property) return `${m.org.name} › ${m.property.name}`
  return m.org.name
}

function matchesActive(m: MembershipSummary): boolean {
  const active = getScope()
  if (!active) return false
  return (
    active.orgId === m.org._id &&
    (active.propertyId ?? null) === (m.property?._id ?? null) &&
    (active.locationId ?? null) === (m.location?._id ?? null)
  )
}

function Switcher() {
  const { data, isLoading } = useQuery({
    queryKey: ['auth', 'memberships'],
    queryFn: async () => {
      const result = await getMyMemberships()
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  if (isLoading) {
    return <span className="text-sm text-salt-500">Loading…</span>
  }

  const memberships = data ?? []
  const active = memberships.find(matchesActive) ?? memberships[0]

  return (
    <div className="flex items-center gap-2">
      {memberships.length > 1 ? (
        <select
          aria-label="Active scope"
          value={active ? active._id : ''}
          onChange={(e) => {
            const chosen = memberships.find((m) => m._id === e.target.value)
            if (!chosen) return
            setScope({
              orgId: chosen.org._id,
              propertyId: chosen.property?._id ?? null,
              locationId: chosen.location?._id ?? null,
            })
            // A full reload is the honest move here: every cached query in the
            // app is scoped, so keeping any of it across a scope change would
            // show one tenant's data under another's header.
            window.location.reload()
          }}
          className="min-h-touch max-w-[18rem] cursor-pointer rounded-xl bg-white px-3 py-1.5 text-sm font-medium text-steel-800 shadow-xs ring-1 ring-salt-300 transition-all duration-150 hover:ring-salt-400 focus:ring-2 focus:ring-ember-400 focus:outline-none"
        >
          {memberships.map((m) => (
            <option key={m._id} value={m._id}>
              {label(m)}
            </option>
          ))}
        </select>
      ) : (
        active && (
          <span className="hidden rounded-full bg-salt-100 px-3 py-1.5 text-sm font-medium text-steel-700 ring-1 ring-salt-200 ring-inset phablet:inline-block">
            {label(active)}
          </span>
        )
      )}

      <a
        href="/profile"
        aria-label="Your profile"
        title="Your profile"
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-salt-600 transition-all duration-150 hover:bg-salt-100 hover:text-steel-900"
      >
        <UserRound className="size-4.5" aria-hidden />
      </a>

      <button
        type="button"
        onClick={() => {
          clearAuth()
          window.location.href = '/login'
        }}
        className="min-h-touch cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-medium text-salt-600 transition-all duration-150 hover:bg-salt-100 hover:text-steel-900"
      >
        Sign out
      </button>
    </div>
  )
}

export function ScopeSwitcher() {
  return (
    <QueryProvider>
      <Switcher />
    </QueryProvider>
  )
}
