import { useQuery } from '@tanstack/react-query'
import type { TenantRole } from '@rit/shared'
import { getMyMemberships } from '../api/auth'
import { getScope } from '../api/client'

/**
 * The caller's tenant role in the active scope, for hiding controls the server
 * would refuse anyway. Cosmetic only — every permission is enforced by the
 * API; this just keeps chef-only buttons off a staff member's screen.
 *
 * Shares the ['auth', 'memberships'] query key with ScopeSwitcher, so inside
 * one QueryProvider the membership list is fetched once.
 */
export function useActiveRole(): { role: TenantRole | null; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['auth', 'memberships'],
    queryFn: async () => {
      const result = await getMyMemberships()
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  const memberships = data ?? []
  const scope = getScope()
  const active =
    memberships.find(
      (m) =>
        scope &&
        m.org._id === scope.orgId &&
        (m.property?._id ?? null) === (scope.propertyId ?? null) &&
        (m.location?._id ?? null) === (scope.locationId ?? null)
    ) ??
    memberships[0] ??
    null

  return { role: active?.role ?? null, isLoading }
}
