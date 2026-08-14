import { useQuery } from '@tanstack/react-query'
import type { TenantTree } from '@rit/shared'
import { getScope } from '@/lib/api/client'
import { getTenantTree, tenancyScopeKey } from '@/features/tenancy/api'
import { inputClass } from '@/components/ui'

/**
 * Property/location placement for anything that lives in the tenant tree —
 * a new recipe, a fork's destination, an invited member. Placement is what
 * decides who can see a thing (visibility flows downward from where it
 * lives), so every create form offers it rather than silently using the
 * caller's browsing scope.
 */

/** '' means "the whole tier above": no property = whole org, no location = whole property. */
export interface ScopeSelection {
  propertyId: string
  locationId: string
}

/** Where a create form starts: the caller's active browsing scope. */
export function defaultScopeSelection(): ScopeSelection {
  const active = getScope()
  return { propertyId: active?.propertyId ?? '', locationId: active?.locationId ?? '' }
}

/** One tree query, shared by every picker and attribution chip via the cache. */
export function useTenantTree() {
  return useQuery({
    queryKey: ['tenancy', 'tree', ...tenancyScopeKey()],
    queryFn: async () => {
      const result = await getTenantTree()
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })
}

/**
 * "Sixty Vines" or "Sixty Vines › Dallas" for a scoped document; null for
 * org-wide ones, so callers can render nothing for the common case.
 */
export function scopeDisplayLabel(
  scope: { propertyId: string | null; locationId: string | null },
  tree: TenantTree | undefined
): string | null {
  if (!scope.propertyId) return null
  const property = tree?.properties.find((p) => p._id === scope.propertyId)
  if (!scope.locationId) return property?.name ?? 'One property'
  const location = property?.locations.find((l) => l._id === scope.locationId)
  return `${property?.name ?? '…'} › ${location?.name ?? '…'}`
}

/**
 * Two selects, meant to be dropped into the caller's form grid. Offers only
 * placements the caller may write at — writing is allowed at their own tier
 * or below, so a property member sees just their property and its locations,
 * and a location member is pinned to their location. The server enforces the
 * same rule; the picker just never offers a choice that would 403.
 */
export function ScopePicker({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string
  value: ScopeSelection
  onChange: (next: ScopeSelection) => void
}) {
  const { data: tree } = useTenantTree()
  const active = getScope()

  const properties = (tree?.properties ?? []).filter(
    (property) => !active?.propertyId || property._id === active.propertyId
  )
  const locations = (
    properties.find((property) => property._id === value.propertyId)?.locations ?? []
  ).filter((location) => !active?.locationId || location._id === active.locationId)

  return (
    <>
      <div>
        <label
          htmlFor={`${idPrefix}-property`}
          className="mb-1.5 block text-sm font-medium text-steel-700"
        >
          Property
        </label>
        <select
          id={`${idPrefix}-property`}
          value={value.propertyId}
          onChange={(e) => onChange({ propertyId: e.target.value, locationId: '' })}
          className={inputClass}
        >
          {!active?.propertyId && <option value="">Whole organization</option>}
          {properties.map((property) => (
            <option key={property._id} value={property._id}>
              {property.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label
          htmlFor={`${idPrefix}-location`}
          className="mb-1.5 block text-sm font-medium text-steel-700"
        >
          Location
        </label>
        <select
          id={`${idPrefix}-location`}
          value={value.locationId}
          onChange={(e) => onChange({ ...value, locationId: e.target.value })}
          disabled={!value.propertyId}
          className={inputClass}
        >
          {!active?.locationId && <option value="">Whole property</option>}
          {locations.map((location) => (
            <option key={location._id} value={location._id}>
              {location.name}
            </option>
          ))}
        </select>
      </div>
    </>
  )
}
