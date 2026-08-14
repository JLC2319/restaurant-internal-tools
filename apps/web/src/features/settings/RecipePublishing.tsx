import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { OrganizationProfile, RecipePublishMode } from '@rit/shared'
import { recipePublishModeValues, resolveRecipePublishMode } from '@rit/shared'
import { GitCommitVertical, Rocket, ShieldCheck, Zap } from 'lucide-react'
import { tenancyScopeKey, updateOrganization } from '@/features/tenancy/api'
import type { ModeMeta } from '@/features/settings/PublishModeSettings'
import {
  ModeRadioGroup,
  OverrideRows,
  PublishModeBody,
} from '@/features/settings/PublishModeSettings'
import { ErrorNote, SavedTick, SectionCard } from '@/components/ui'

/**
 * How much ceremony stands between writing a brand-new recipe and staff being
 * able to cook from it.
 *
 * Only ever consulted for a lineage that has never been live. A recipe staff
 * already read always changes the deliberate way — save a version, then set it
 * live — whatever this is set to, and the copy below says so, because a setting
 * that looks like it governs more than it does is worse than no setting.
 *
 * SAFETY: no mode here approves an allergen tag. `publish_on_save` offers the
 * chef a sign-off tick beside the publish toggle; `publish_on_save_verified`
 * insists on it. Skipped, the recipe goes live reading *Unverified* to staff,
 * exactly as an unsigned recipe does today — which is why the modes run
 * strict-est last rather than loosest last.
 */

const MODE_META: Record<RecipePublishMode, ModeMeta> = {
  manual: {
    label: 'Manual',
    icon: GitCommitVertical,
    summary: 'Save a version, then set it live',
    detail:
      'Every recipe starts as a draft only chefs can see. Getting one to staff is two deliberate steps, however new it is. This is how the app behaved before the shortcut existed.',
  },
  publish_on_save: {
    label: 'Publish on save',
    icon: Zap,
    summary: 'One save puts a new recipe in front of staff',
    detail:
      'The editor offers a “Publish on save” switch on recipes that have never been live. Saving mints v1 and publishes it. Allergen sign-off sits beside the switch as the chef’s call — skipped, the recipe reads “Unverified” to staff until someone signs off.',
  },
  publish_on_save_verified: {
    label: 'Publish on save, allergens signed off',
    icon: ShieldCheck,
    summary: 'The same shortcut, sign-off required',
    detail:
      'As above, but the shortcut refuses to publish until a chef has verified the allergen tags in the same step. The slower two-step route is still there for anything not ready for that.',
  },
}

function tone(mode: RecipePublishMode): string {
  return mode === 'publish_on_save_verified' ? 'ring-basil-300 bg-basil-50/40' : 'ring-salt-300 bg-white'
}

function selectedTone(mode: RecipePublishMode): string {
  return mode === 'publish_on_save_verified'
    ? 'ring-2 ring-basil-400 bg-basil-50 shadow-sm'
    : 'ring-2 ring-ember-400 bg-ember-50/50 shadow-sm'
}

function iconTone(mode: RecipePublishMode): string {
  return mode === 'publish_on_save_verified'
    ? 'bg-basil-100 text-basil-700 ring-basil-200'
    : 'bg-salt-100 text-steel-600 ring-salt-200'
}

// ── The org-wide default ──────────────────────────────────────────────────────

function OrgDefault({ org, canEdit }: { org: OrganizationProfile; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const save = useMutation({
    mutationFn: async (next: RecipePublishMode) => {
      const result = await updateOrganization({ settings: { recipePublishMode: next } })
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

      <ModeRadioGroup
        ariaLabel="Organization recipe publishing"
        modes={recipePublishModeValues}
        meta={MODE_META}
        value={org.settings.recipePublishMode}
        disabled={!canEdit || save.isPending}
        onSelect={(next) => {
          setError(null)
          setSaved(false)
          save.mutate(next)
        }}
        tone={tone}
        selectedTone={selectedTone}
        iconTone={iconTone}
      />

      <div className="flex items-center gap-3">
        <SavedTick show={saved && !save.isPending} />
        {save.isPending && <span className="text-sm text-salt-500">Saving…</span>}
      </div>
    </div>
  )
}

// ── The card ──────────────────────────────────────────────────────────────────

export function RecipePublishingCard({
  org,
  canEditOrg,
  canEditOverrides,
}: {
  org: OrganizationProfile
  canEditOrg: boolean
  canEditOverrides: boolean
}) {
  return (
    <SectionCard
      icon={Rocket}
      title="Recipe publishing"
      hint="How a brand-new recipe reaches your staff"
    >
      <PublishModeBody
        notice={
          <p className="rounded-xl bg-salt-50 px-4 py-3 text-sm text-salt-600 ring-1 ring-salt-200 ring-inset">
            This governs recipes that have never been live — the ones a kitchen types in when it
            adopts the app. A recipe staff already cook from always changes the deliberate way: save
            a version, then set it live.
          </p>
        }
        picker={<OrgDefault org={org} canEdit={canEditOrg} />}
        overrides={
          <OverrideRows
            settingsKey="recipePublishMode"
            modes={recipePublishModeValues}
            meta={MODE_META}
            orgMode={org.settings.recipePublishMode}
            resolve={resolveRecipePublishMode}
            canEdit={canEditOverrides}
            labelFor={(name) => `Recipe publishing for ${name}`}
          />
        }
      />
    </SectionCard>
  )
}
