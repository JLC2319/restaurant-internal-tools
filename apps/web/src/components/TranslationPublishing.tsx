import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  LocationSummary,
  OrganizationProfile,
  PropertySummary,
  TranslationPublishMode,
} from '@rit/shared'
import { resolveTranslationPublishMode, translationPublishModeValues } from '@rit/shared'
import { Building2, Check, Languages, MapPin, ShieldAlert, Sparkles, UserCheck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  getTenantTree,
  tenancyScopeKey,
  updateLocation,
  updateOrganization,
  updateProperty,
} from '../api/tenancy'
import { ErrorNote, SectionCard, Skeleton, inputClass } from './ui'

/**
 * Where a tenant decides what publishing a recipe does to its Spanish.
 *
 * The setting lives at all three tiers — organization, property, location —
 * and resolves narrowest-first, so a group can default to review-everything
 * while one fast-casual brand runs automatic. The org row is always concrete;
 * the rows below it start at "inherit".
 *
 * SAFETY: `auto_publish` is the one setting in the product that lets
 * machine-written text reach kitchen staff with nobody reading it first. It is
 * presented as the deliberate exception it is, and the warning below only
 * appears once it is actually chosen.
 */

interface ModeMeta {
  label: string
  icon: LucideIcon
  summary: string
  detail: string
}

const MODE_META: Record<TranslationPublishMode, ModeMeta> = {
  manual: {
    label: 'Manual',
    icon: UserCheck,
    summary: 'Nothing happens automatically',
    detail:
      'A chef presses “Translate to Spanish” on the recipe, reviews it, and approves. This is how the app behaves today.',
  },
  auto_review: {
    label: 'Automatic, then review',
    icon: Sparkles,
    summary: 'Translates on publish, waits for a chef',
    detail:
      'Setting a version live starts the translation in the background. It lands awaiting review — staff see nothing until a chef reads it and approves.',
  },
  auto_publish: {
    label: 'Automatic, straight to staff',
    icon: ShieldAlert,
    summary: 'Translates on publish, no review',
    detail:
      'Setting a version live translates and publishes it to the reader immediately. Nobody reads the Spanish before your line cooks do.',
  },
}

/** The chrome for the option list. Citron reads “review” across the app. */
const modeCardTone: Record<TranslationPublishMode, string> = {
  manual: 'ring-salt-300 bg-white',
  auto_review: 'ring-salt-300 bg-white',
  auto_publish: 'ring-citron-300 bg-citron-50/40',
}

function selectedTone(mode: TranslationPublishMode): string {
  return mode === 'auto_publish'
    ? 'ring-2 ring-citron-400 bg-citron-50 shadow-sm'
    : 'ring-2 ring-ember-400 bg-ember-50/50 shadow-sm'
}

/**
 * SAFETY: shown only while auto-publish is the live choice. Chili is the
 * product's "someone could get hurt" colour and this is the one settings
 * decision that earns it — an unreviewed allergen note reaching the line.
 */
function AutoPublishWarning() {
  return (
    <p
      role="alert"
      className="flex items-start gap-2.5 rounded-xl bg-chili-50 px-4 py-3 text-sm text-chili-700 ring-1 ring-chili-200 ring-inset"
    >
      <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        Machine-translated text will reach kitchen staff with no human review. A mistranslated
        allergen note or temperature becomes a food-safety incident, not a typo. The reader marks
        these recipes as unreviewed, and any chef can still open one and correct it.
      </span>
    </p>
  )
}

function SavedTick({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-basil-600">
      <Check className="size-4" aria-hidden />
      Saved
    </span>
  )
}

// ── The org-wide default ──────────────────────────────────────────────────────

function OrgDefault({ org, canEdit }: { org: OrganizationProfile; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const mode = org.settings.translationPublishMode

  const save = useMutation({
    mutationFn: async (next: TranslationPublishMode) => {
      const result = await updateOrganization({ settings: { translationPublishMode: next } })
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['org', 'profile', ...tenancyScopeKey()], updated)
      setSaved(true)
    },
    onError: (err: Error) => setError(err.message),
  })

  return (
    <div className="space-y-4">
      {error && <ErrorNote>{error}</ErrorNote>}

      <div role="radiogroup" aria-label="Organization translation publishing" className="space-y-2.5">
        {translationPublishModeValues.map((value) => {
          const meta = MODE_META[value]
          const Icon = meta.icon
          const isSelected = mode === value
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={!canEdit || save.isPending}
              onClick={() => {
                if (isSelected) return
                setError(null)
                setSaved(false)
                save.mutate(value)
              }}
              className={`flex w-full cursor-pointer items-start gap-3 rounded-xl p-4 text-left ring-1 transition-all duration-150 ring-inset hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:shadow-none ${
                isSelected ? selectedTone(value) : modeCardTone[value]
              }`}
            >
              <span
                className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${
                  value === 'auto_publish'
                    ? 'bg-citron-100 text-citron-700 ring-citron-200'
                    : 'bg-salt-100 text-steel-600 ring-salt-200'
                }`}
              >
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-steel-900">{meta.label}</span>
                  <span className="text-xs text-salt-500">{meta.summary}</span>
                </span>
                <span className="mt-1 block text-sm leading-relaxed text-salt-600">
                  {meta.detail}
                </span>
              </span>
              {isSelected && (
                <Check className="mt-1 size-4 shrink-0 text-ember-600" aria-hidden />
              )}
            </button>
          )
        })}
      </div>

      {mode === 'auto_publish' && <AutoPublishWarning />}

      <div className="flex items-center gap-3">
        <SavedTick show={saved && !save.isPending} />
        {save.isPending && <span className="text-sm text-salt-500">Saving…</span>}
      </div>
    </div>
  )
}

// ── Per-property and per-location overrides ───────────────────────────────────

/** `null` is a real choice here — "stop overriding, follow the parent again". */
function OverrideSelect({
  id,
  label,
  value,
  inherited,
  disabled,
  pending,
  onChange,
}: {
  id: string
  label: string
  value: TranslationPublishMode | null
  inherited: TranslationPublishMode
  disabled: boolean
  pending: boolean
  onChange: (next: TranslationPublishMode | null) => void
}) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value ?? 'inherit'}
      disabled={disabled || pending}
      onChange={(e) => {
        const next = e.target.value
        onChange(next === 'inherit' ? null : (next as TranslationPublishMode))
      }}
      className={`${inputClass} w-auto min-w-[15rem] py-2 text-sm ${disabled ? 'opacity-60' : ''}`}
    >
      <option value="inherit">Inherit — {MODE_META[inherited].label}</option>
      {translationPublishModeValues.map((mode) => (
        <option key={mode} value={mode}>
          {MODE_META[mode].label}
        </option>
      ))}
    </select>
  )
}

function OverrideRows({ org, canEdit }: { org: OrganizationProfile; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const treeKey = ['tenancy', 'tree', ...tenancyScopeKey()]
  const { data, isLoading } = useQuery({
    queryKey: treeKey,
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
      mode: TranslationPublishMode | null
    }) => {
      const body = { settings: { translationPublishMode: change.mode } }
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

  function change(tier: 'property' | 'location', id: string, mode: TranslationPublishMode | null) {
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

  const orgMode = org.settings.translationPublishMode

  return (
    <div className="space-y-3">
      {error && <ErrorNote>{error}</ErrorNote>}

      {data.properties.map((property: PropertySummary & { locations: LocationSummary[] }) => {
        const propertyEffective = resolveTranslationPublishMode(
          orgMode,
          property.settings.translationPublishMode
        )
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
                id={`tpm-property-${property._id}`}
                label={`Translation publishing for ${property.name}`}
                value={property.settings.translationPublishMode}
                inherited={orgMode}
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
                      id={`tpm-location-${location._id}`}
                      label={`Translation publishing for ${location.name}`}
                      value={location.settings.translationPublishMode}
                      inherited={propertyEffective}
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

// ── The card ──────────────────────────────────────────────────────────────────

export function TranslationPublishingCard({
  org,
  canEditOrg,
  canEditOverrides,
}: {
  org: OrganizationProfile
  canEditOrg: boolean
  canEditOverrides: boolean
}) {
  const spanish = org.locales.includes('es')

  return (
    <SectionCard
      icon={Languages}
      title="Translation publishing"
      hint="What happens to a recipe's Spanish when a version goes live"
    >
      <div className="space-y-6">
        {!spanish && (
          <p className="rounded-xl bg-salt-50 px-4 py-3 text-sm text-salt-600 ring-1 ring-salt-200 ring-inset">
            Español is switched off for this organization, so nothing is translated whatever this is
            set to. Turn it on under Details above.
          </p>
        )}

        <div>
          <p className="mb-3 text-sm font-medium text-steel-700">Organization default</p>
          <OrgDefault org={org} canEdit={canEditOrg} />
        </div>

        <div className="border-t border-salt-100 pt-5">
          <p className="text-sm font-medium text-steel-700">Overrides</p>
          <p className="mb-3 text-xs text-salt-600">
            A property or location may differ from the organization. The narrowest setting wins:
            location, then property, then organization.
          </p>
          <OverrideRows org={org} canEdit={canEditOverrides} />
        </div>
      </div>
    </SectionCard>
  )
}
