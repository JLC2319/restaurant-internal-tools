import { useQuery } from '@tanstack/react-query'
import type { MembershipSummary } from '@rit/shared'
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
    return <span className="text-sm text-salt-400">Loading…</span>
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
          className="min-h-touch max-w-[18rem] rounded-md border border-steel-600 bg-steel-700 px-2 py-1 text-sm text-salt-50"
        >
          {memberships.map((m) => (
            <option key={m._id} value={m._id}>
              {label(m)}
            </option>
          ))}
        </select>
      ) : (
        active && <span className="text-sm text-salt-300">{label(active)}</span>
      )}

      <button
        type="button"
        onClick={() => {
          clearAuth()
          window.location.href = '/login'
        }}
        className="min-h-touch rounded-md px-3 py-1 text-sm font-medium text-salt-300 hover:bg-steel-700 hover:text-salt-50"
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
