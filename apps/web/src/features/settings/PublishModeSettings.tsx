import { useState } from 'react'
import type { ReactNode } from 'react'
import type { LocationSummary, PropertySummary, TenantSettingsOverride } from '@rit/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Check, MapPin } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  getTenantTree,
  tenancyScopeKey,
  updateLocation,
  updateProperty,
} from '@/features/tenancy/api'
import { ErrorNote, Skeleton, inputClass } from '@/components/ui'

/**
 * The shared machinery behind every "how does publishing behave here" setting.
 *
 * Each of these settings has the same shape — a concrete org default, optional
 * per-property and per-location overrides where `null` means inherit, and
 * narrowest-first resolution — so the picker, the override rows and the
 * dot-notation PATCH live here once. What differs between them is the copy, the
 * mode list and the chrome, which each card supplies.
 *
 * Nothing in here decides anything: a card passes its own `resolve` and its own
 * mode metadata, and this file only renders and writes what it is handed.
 */

export interface ModeMeta {
  label: string
  icon: LucideIcon
  summary: string
  detail: string
}

/** Keys of the settings sub-document these controls can write. */
export type PublishModeKey = keyof TenantSettingsOverride

/** The mode union belonging to one settings key — `'manual' | …` for that key. */
export type ModeOf<K extends PublishModeKey> = NonNullable<TenantSettingsOverride[K]>

export function SavedTick({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-basil-600">
      <Check className="size-4" aria-hidden />
      Saved
    </span>
  )
}

/**
 * The org-level picker: one card per mode, radio semantics.
 *
 * `tone` and `iconTone` are per-mode so a card can colour the one option that
 * deserves a second look — the translation card marks its unreviewed mode in
 * citron — without this component knowing which mode that is.
 */
export function ModeRadioGroup<M extends string>({
  ariaLabel,
  modes,
  meta,
  value,
  disabled,
  onSelect,
  tone,
  selectedTone,
  iconTone,
}: {
  ariaLabel: string
  modes: readonly M[]
  meta: Record<M, ModeMeta>
  value: M
  disabled: boolean
  onSelect: (mode: M) => void
  tone?: (mode: M) => string
  selectedTone?: (mode: M) => string
  iconTone?: (mode: M) => string
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="space-y-2.5">
      {modes.map((mode) => {
        const entry = meta[mode]
        const Icon = entry.icon
        const isSelected = value === mode
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={disabled}
            onClick={() => {
              if (!isSelected) onSelect(mode)
            }}
            className={`flex w-full cursor-pointer items-start gap-3 rounded-xl p-4 text-left ring-1 transition-all duration-150 ring-inset hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:shadow-none ${
              isSelected
                ? (selectedTone?.(mode) ?? 'ring-2 ring-ember-400 bg-ember-50/50 shadow-sm')
                : (tone?.(mode) ?? 'ring-salt-300 bg-white')
            }`}
          >
            <span
              className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${
                iconTone?.(mode) ?? 'bg-salt-100 text-steel-600 ring-salt-200'
              }`}
            >
              <Icon className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-steel-900">{entry.label}</span>
                <span className="text-xs text-salt-500">{entry.summary}</span>
              </span>
              <span className="mt-1 block text-sm leading-relaxed text-salt-600">
                {entry.detail}
              </span>
            </span>
            {isSelected && <Check className="mt-1 size-4 shrink-0 text-ember-600" aria-hidden />}
          </button>
        )
      })}
    </div>
  )
}

/** `null` is a real choice here — "stop overriding, follow the parent again". */
function OverrideSelect<M extends string>({
  id,
  label,
  value,
  inherited,
  modes,
  meta,
  disabled,
  pending,
  onChange,
}: {
  id: string
  label: string
  value: M | null
  inherited: M
  modes: readonly M[]
  meta: Record<M, ModeMeta>
  disabled: boolean
  pending: boolean
  onChange: (next: M | null) => void
}) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value ?? 'inherit'}
      disabled={disabled || pending}
      onChange={(e) => {
        const next = e.target.value
        onChange(next === 'inherit' ? null : (next as M))
      }}
      className={`${inputClass} w-auto min-w-[15rem] py-2 text-sm ${disabled ? 'opacity-60' : ''}`}
    >
      <option value="inherit">Inherit — {meta[inherited].label}</option>
      {modes.map((mode) => (
        <option key={mode} value={mode}>
          {meta[mode].label}
        </option>
      ))}
    </select>
  )
}

/**
 * Per-property and per-location overrides for one settings key.
 *
 * The PATCH body names a single key, so the API's `applySettingsPatch` writes
 * one dot-notation field and leaves every other setting on the document alone —
 * sending the sub-document whole would silently clear the rest.
 */
export function OverrideRows<K extends PublishModeKey>({
  settingsKey,
  modes,
  meta,
  orgMode,
  resolve,
  canEdit,
  labelFor,
}: {
  settingsKey: K
  modes: readonly ModeOf<K>[]
  meta: Record<ModeOf<K>, ModeMeta>
  orgMode: ModeOf<K>
  /** The card's own narrowest-first resolver, shared with the server. */
  resolve: (org: ModeOf<K>, property?: ModeOf<K> | null) => ModeOf<K>
  canEdit: boolean
  /** e.g. `(name) => \`Recipe publishing for ${name}\`` — the select's a11y label. */
  labelFor: (tenantName: string) => string
}) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['tenancy', 'tree', ...tenancyScopeKey()],
    queryFn: async () => {
      const result = await getTenantTree()
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  const save = useMutation({
    mutationFn: async (change: {
      tier: 'property' | 'location'
      id: string
      mode: ModeOf<K> | null
    }) => {
      const body = { settings: { [settingsKey]: change.mode } }
      const result =
        change.tier === 'property'
          ? await updateProperty(change.id, body)
          : await updateLocation(change.id, body)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    onSettled: () => {
      setPendingId(null)
      queryClient.invalidateQueries({ queryKey: ['tenancy', 'tree'] })
    },
    onError: (err: Error) => setError(err.message),
  })

  function change(tier: 'property' | 'location', id: string, mode: ModeOf<K> | null) {
    setError(null)
    setPendingId(id)
    save.mutate({ tier, id, mode })
  }

  if (isLoading) return <Skeleton className="h-32 w-full rounded-xl" />
  if (!data || data.properties.length === 0) {
    return (
      <p className="text-sm text-salt-600">
        No properties yet. Once you add properties and locations, each can override the
        organization&rsquo;s setting here.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {error && <ErrorNote>{error}</ErrorNote>}

      {data.properties.map((property: PropertySummary & { locations: LocationSummary[] }) => {
        const propertyOverride = property.settings[settingsKey] as ModeOf<K> | null
        const propertyEffective = resolve(orgMode, propertyOverride)
        return (
          <div
            key={property._id}
            className="rounded-xl bg-salt-50 p-4 ring-1 ring-salt-200 ring-inset"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2 font-medium text-steel-900">
                <Building2 className="size-4 text-salt-500" aria-hidden />
                {property.name}
              </span>
              <OverrideSelect
                id={`${settingsKey}-property-${property._id}`}
                label={labelFor(property.name)}
                value={propertyOverride}
                inherited={orgMode}
                modes={modes}
                meta={meta}
                disabled={!canEdit}
                pending={pendingId === property._id}
                onChange={(next) => change('property', property._id, next)}
              />
            </div>

            {property.locations.length > 0 && (
              <ul className="mt-3 space-y-2 border-l-2 border-salt-200 pl-4">
                {property.locations.map((location) => (
                  <li
                    key={location._id}
                    className="flex flex-wrap items-center justify-between gap-3"
                  >
                    <span className="flex items-center gap-2 text-sm text-steel-800">
                      <MapPin className="size-4 text-salt-500" aria-hidden />
                      {location.name}
                    </span>
                    <OverrideSelect
                      id={`${settingsKey}-location-${location._id}`}
                      label={labelFor(location.name)}
                      value={location.settings[settingsKey] as ModeOf<K> | null}
                      inherited={propertyEffective}
                      modes={modes}
                      meta={meta}
                      disabled={!canEdit}
                      pending={pendingId === location._id}
                      onChange={(next) => change('location', location._id, next)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * The two-part body every publishing card shares: the org default above, the
 * override tree below. `notice` is the card's own preamble (the translation
 * card warns when Español is off), `warning` its own alert under the picker.
 */
export function PublishModeBody({
  notice,
  picker,
  warning,
  overrides,
}: {
  notice?: ReactNode
  picker: ReactNode
  warning?: ReactNode
  overrides: ReactNode
}) {
  return (
    <div className="space-y-6">
      {notice}

      <div>
        <p className="mb-3 text-sm font-medium text-steel-700">Organization default</p>
        <div className="space-y-4">
          {picker}
          {warning}
        </div>
      </div>

      <div className="border-t border-salt-100 pt-5">
        <p className="text-sm font-medium text-steel-700">Overrides</p>
        <p className="mb-3 text-xs text-salt-600">
          A property or location may differ from the organization. The narrowest setting wins:
          location, then property, then organization.
        </p>
        {overrides}
      </div>
    </div>
  )
}
