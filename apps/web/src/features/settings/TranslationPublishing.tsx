import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { OrganizationProfile, TranslationPublishMode } from '@rit/shared';
import { resolveTranslationPublishMode, translationPublishModeValues } from '@rit/shared';
import { Languages, ShieldAlert, Sparkles, UserCheck } from 'lucide-react';
import { tenancyScopeKey, updateOrganization } from '@/features/tenancy/api';
import type { ModeMeta } from '@/features/settings/PublishModeSettings';
import {
  ModeRadioGroup,
  OverrideRows,
  PublishModeBody,
} from '@/features/settings/PublishModeSettings';
import { ErrorNote, SavedTick, SectionCard } from '@/components/ui';

/**
 * Where a tenant decides what publishing does to the Spanish — one card for
 * recipes, one for training modules. The two are independent settings with
 * identical modes and cascade (organization → property → location, resolved
 * narrowest-first), so a group can auto-publish menu Spanish while keeping a
 * human review on training material, or the reverse. The picker, override
 * rows and PATCH wiring are shared with the other publishing settings — see
 * `PublishModeSettings`.
 *
 * SAFETY: `auto_publish` is the one setting in the product that lets
 * machine-written text reach staff with nobody reading it first. It is
 * presented as the deliberate exception it is, and the warning below only
 * appears once it is actually chosen.
 */

type TranslationSettingsKey = 'translationPublishMode' | 'trainingTranslationPublishMode';

/** Everything that differs between the recipe card and the training card. */
interface Variant {
  settingsKey: TranslationSettingsKey;
  title: string;
  hint: string;
  ariaLabel: string;
  meta: Record<TranslationPublishMode, ModeMeta>;
  warning: string;
  labelFor: (name: string) => string;
}

const RECIPE_VARIANT: Variant = {
  settingsKey: 'translationPublishMode',
  title: 'Translation publishing — recipes',
  hint: "What happens to a recipe's Spanish when a version goes live",
  ariaLabel: 'Organization recipe translation publishing',
  meta: {
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
  },
  warning:
    'Machine-translated text will reach kitchen staff with no human review. A mistranslated allergen note or temperature becomes a food-safety incident, not a typo. The reader marks these recipes as unreviewed, and any chef can still open one and correct it.',
  labelFor: (name) => `Recipe translation publishing for ${name}`,
};

const TRAINING_VARIANT: Variant = {
  settingsKey: 'trainingTranslationPublishMode',
  title: 'Translation publishing — training',
  hint: "What happens to a training module's Spanish when it is published",
  ariaLabel: 'Organization training translation publishing',
  meta: {
    manual: {
      label: 'Manual',
      icon: UserCheck,
      summary: 'Nothing happens automatically',
      detail:
        'A chef presses “Translate to Spanish” on the training, reviews it, and approves. Nothing is translated until then.',
    },
    auto_review: {
      label: 'Automatic, then review',
      icon: Sparkles,
      summary: 'Translates on publish, waits for a chef',
      detail:
        'Publishing a module (or editing a published one) starts the translation in the background. It lands awaiting review — staff see nothing until a chef reads it and approves.',
    },
    auto_publish: {
      label: 'Automatic, straight to staff',
      icon: ShieldAlert,
      summary: 'Translates on publish, no review',
      detail:
        'Publishing a module translates and publishes it to the reader immediately. Nobody reads the Spanish before your staff do.',
    },
  },
  warning:
    'Machine-translated training will reach staff with no human review. A mistranslated safety procedure, temperature or hold time becomes an incident on the floor, not a typo. The reader marks these modules as unreviewed, and any chef can still open one and correct it.',
  labelFor: (name) => `Training translation publishing for ${name}`,
};

/** The chrome for the option list. Citron reads “review” across the app. */
function tone(mode: TranslationPublishMode): string {
  return mode === 'auto_publish' ? 'ring-citron-300 bg-citron-50/40' : 'ring-salt-300 bg-white';
}

function selectedTone(mode: TranslationPublishMode): string {
  return mode === 'auto_publish'
    ? 'ring-2 ring-citron-400 bg-citron-50 shadow-sm'
    : 'ring-2 ring-ember-400 bg-ember-50/50 shadow-sm';
}

function iconTone(mode: TranslationPublishMode): string {
  return mode === 'auto_publish'
    ? 'bg-citron-100 text-citron-700 ring-citron-200'
    : 'bg-salt-100 text-steel-600 ring-salt-200';
}

/**
 * SAFETY: shown only while auto-publish is the live choice. Chili is the
 * product's "someone could get hurt" colour and this is the one settings
 * decision that earns it — unreviewed machine text reaching the line.
 */
function AutoPublishWarning({ children }: { children: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2.5 rounded-xl bg-chili-50 px-4 py-3 text-sm text-chili-700 ring-1 ring-chili-200 ring-inset"
    >
      <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

// ── The org-wide default ──────────────────────────────────────────────────────

function OrgDefault({
  org,
  canEdit,
  variant,
}: {
  org: OrganizationProfile;
  canEdit: boolean;
  variant: Variant;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const mode = org.settings[variant.settingsKey];

  const save = useMutation({
    mutationFn: async (next: TranslationPublishMode) => {
      const result = await updateOrganization({ settings: { [variant.settingsKey]: next } });
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['org', 'profile', ...tenancyScopeKey()], updated);
      setSaved(true);
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="space-y-4">
      {error && <ErrorNote>{error}</ErrorNote>}

      <ModeRadioGroup
        ariaLabel={variant.ariaLabel}
        modes={translationPublishModeValues}
        meta={variant.meta}
        value={mode}
        disabled={!canEdit || save.isPending}
        onSelect={(next) => {
          setError(null);
          setSaved(false);
          save.mutate(next);
        }}
        tone={tone}
        selectedTone={selectedTone}
        iconTone={iconTone}
      />

      {mode === 'auto_publish' && <AutoPublishWarning>{variant.warning}</AutoPublishWarning>}

      <div className="flex items-center gap-3">
        <SavedTick show={saved && !save.isPending} />
        {save.isPending && <span className="text-sm text-salt-500">Saving…</span>}
      </div>
    </div>
  );
}

// ── The cards ─────────────────────────────────────────────────────────────────

function TranslationCard({
  org,
  canEditOrg,
  canEditOverrides,
  variant,
}: {
  org: OrganizationProfile;
  canEditOrg: boolean;
  canEditOverrides: boolean;
  variant: Variant;
}) {
  const spanish = org.locales.includes('es');

  return (
    <SectionCard icon={Languages} title={variant.title} hint={variant.hint}>
      <PublishModeBody
        notice={
          !spanish && (
            <p className="rounded-xl bg-salt-50 px-4 py-3 text-sm text-salt-600 ring-1 ring-salt-200 ring-inset">
              Español is switched off for this organization, so nothing is translated whatever this
              is set to. Turn it on under Details above.
            </p>
          )
        }
        picker={<OrgDefault org={org} canEdit={canEditOrg} variant={variant} />}
        overrides={
          <OverrideRows
            settingsKey={variant.settingsKey}
            modes={translationPublishModeValues}
            meta={variant.meta}
            orgMode={org.settings[variant.settingsKey]}
            resolve={resolveTranslationPublishMode}
            canEdit={canEditOverrides}
            labelFor={variant.labelFor}
          />
        }
      />
    </SectionCard>
  );
}

export function TranslationPublishingCard(props: {
  org: OrganizationProfile;
  canEditOrg: boolean;
  canEditOverrides: boolean;
}) {
  return <TranslationCard {...props} variant={RECIPE_VARIANT} />;
}

export function TrainingTranslationPublishingCard(props: {
  org: OrganizationProfile;
  canEditOrg: boolean;
  canEditOverrides: boolean;
}) {
  return <TranslationCard {...props} variant={TRAINING_VARIANT} />;
}
