import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';

/**
 * The automatic side of translation: what a version going live does to a
 * recipe's Spanish, per the org/property/location setting.
 *
 * The LLM is mocked at the SDK boundary, so the projection, alignment and
 * staleness logic under test is the real thing. The pure helpers
 * (`translatableProjection`, `sanitizePayload`) have their own suite; the HTTP
 * flows have the integration suite.
 */

// Mocked with the same module ids the service resolves, per AGENTS §11.
vi.mock('../../../features/recipes/recipe.model', () => ({
  Recipe: { findById: vi.fn() },
}));
vi.mock('../../../features/recipes/recipeVersion.model', () => ({
  RecipeVersion: { findById: vi.fn() },
}));
vi.mock('../../../features/translations/translation.model', () => ({
  RecipeTranslation: { findOne: vi.fn(), findOneAndUpdate: vi.fn(), updateMany: vi.fn() },
}));
vi.mock('../../../features/tenancy/organization.model', () => ({
  Organization: { findById: vi.fn() },
}));
vi.mock('../../../features/tenancy/property.model', () => ({ Property: { findById: vi.fn() } }));
vi.mock('../../../features/tenancy/location.model', () => ({ Location: { findById: vi.fn() } }));
vi.mock('../../../lib/anthropic', () => ({ anthropic: vi.fn() }));

import { Recipe } from '../../../features/recipes/recipe.model';
import { RecipeVersion } from '../../../features/recipes/recipeVersion.model';
import { RecipeTranslation } from '../../../features/translations/translation.model';
import { Organization } from '../../../features/tenancy/organization.model';
import { Property } from '../../../features/tenancy/property.model';
import { Location } from '../../../features/tenancy/location.model';
import { anthropic } from '../../../lib/anthropic';
import {
  autoTranslateOnPublish,
  resolvePublishModeForScope,
  sourceHashOf,
  translatableProjection,
} from '../../../features/translations/translation.service';
import { env } from '../../../config/env';
import type { TranslationPublishMode } from '@rit/shared';

const ORG = new Types.ObjectId();
const PROPERTY = new Types.ObjectId();
const LOCATION = new Types.ObjectId();
const RECIPE = new Types.ObjectId();
const VERSION = new Types.ObjectId();
const ACTOR = '507f1f77bcf86cd799439011';

const CONTENT = {
  description: 'A bright vinaigrette',
  ingredients: [
    { kind: 'item', name: 'Olive oil', quantity: { amount: 1, unit: 'cup' }, note: null },
  ],
  steps: ['Whisk everything.'],
};

const SPANISH = {
  name: 'Vinagreta de la casa',
  description: 'Una vinagreta fresca',
  ingredients: [{ name: 'Aceite de oliva', note: null }],
  steps: ['Bate todo.'],
};

/** A `.lean()` terminal. */
function lean(result: unknown) {
  return { lean: vi.fn().mockResolvedValue(result) };
}

/** A `.select(...).lean()` chain. */
function selectLean(result: unknown) {
  return { select: vi.fn().mockReturnValue(lean(result)) };
}

function head(overrides: Record<string, unknown> = {}) {
  return {
    _id: RECIPE,
    name: 'House Vinaigrette',
    status: 'active',
    activeVersionId: VERSION,
    activeVersion: 3,
    scope: { orgId: ORG, propertyId: null, locationId: null },
    ...overrides,
  };
}

/** Wires every read the happy path makes, at the given mode. */
function arrange({
  mode = 'auto_review' as TranslationPublishMode,
  recipe = head(),
  existingTranslation = null as unknown,
  /** What the head looks like when re-read after the LLM returns. */
  afterLlm = undefined as Record<string, unknown> | undefined,
} = {}) {
  vi.mocked(Organization.findById).mockReturnValue(
    selectLean({ settings: { translationPublishMode: mode }, locales: ['en', 'es'] }) as never,
  );
  vi.mocked(Property.findById).mockReturnValue(selectLean(null) as never);
  vi.mocked(Location.findById).mockReturnValue(selectLean(null) as never);

  // First read: the whole head. Second read (post-LLM): the freshness check.
  vi.mocked(Recipe.findById)
    .mockReturnValueOnce(lean(recipe) as never)
    .mockReturnValueOnce(selectLean(afterLlm ?? recipe) as never);

  vi.mocked(RecipeVersion.findById).mockReturnValue(
    selectLean({ _id: VERSION, version: 3, content: CONTENT }) as never,
  );
  vi.mocked(RecipeTranslation.findOne).mockReturnValue(selectLean(existingTranslation) as never);
  vi.mocked(RecipeTranslation.findOneAndUpdate).mockResolvedValue({} as never);

  const parse = vi.fn().mockResolvedValue({ parsed_output: SPANISH });
  vi.mocked(anthropic).mockReturnValue({ messages: { parse } } as never);
  return { parse };
}

/** The `$set` of the single upsert the run performed. */
function writtenSet() {
  const call = vi.mocked(RecipeTranslation.findOneAndUpdate).mock.calls[0];
  return (call?.[1] as { $set: Record<string, unknown> })?.$set;
}

beforeEach(() => {
  vi.resetAllMocks();
  // The test env has no ANTHROPIC_API_KEY, so the flag is off by default;
  // these tests are about what the *setting* does, not the deployment.
  Object.assign(env, { translationEnabled: true });
});

describe('resolvePublishModeForScope', () => {
  it('prefers a location override over its property and org', async () => {
    vi.mocked(Organization.findById).mockReturnValue(
      selectLean({
        settings: { translationPublishMode: 'manual' },
        locales: ['en', 'es'],
      }) as never,
    );
    vi.mocked(Property.findById).mockReturnValue(
      selectLean({ settings: { translationPublishMode: 'auto_review' } }) as never,
    );
    vi.mocked(Location.findById).mockReturnValue(
      selectLean({ settings: { translationPublishMode: 'auto_publish' } }) as never,
    );

    const mode = await resolvePublishModeForScope({
      orgId: ORG,
      propertyId: PROPERTY,
      locationId: LOCATION,
    });
    expect(mode).toBe('auto_publish');
  });

  it('falls through an unset tier to the org', async () => {
    vi.mocked(Organization.findById).mockReturnValue(
      selectLean({
        settings: { translationPublishMode: 'auto_review' },
        locales: ['en', 'es'],
      }) as never,
    );
    vi.mocked(Property.findById).mockReturnValue(selectLean({ settings: {} }) as never);
    vi.mocked(Location.findById).mockReturnValue(selectLean(null) as never);

    const mode = await resolvePublishModeForScope({
      orgId: ORG,
      propertyId: PROPERTY,
      locationId: null,
    });
    expect(mode).toBe('auto_review');
  });

  // Orgs created before the setting existed have no value stored anywhere.
  it('defaults to manual when nothing is configured', async () => {
    vi.mocked(Organization.findById).mockReturnValue(selectLean({ locales: ['en'] }) as never);
    const mode = await resolvePublishModeForScope({
      orgId: ORG,
      propertyId: null,
      locationId: null,
    });
    expect(mode).toBe('manual');
  });
});

describe('autoTranslateOnPublish', () => {
  it('does nothing at all in manual mode — no model call, no write', async () => {
    const { parse } = arrange({ mode: 'manual' });
    await autoTranslateOnPublish(RECIPE, ACTOR);
    expect(parse).not.toHaveBeenCalled();
    expect(RecipeTranslation.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('writes pending_review in auto_review — the gate still stands', async () => {
    arrange({ mode: 'auto_review' });
    await autoTranslateOnPublish(RECIPE, ACTOR);

    const set = writtenSet();
    expect(set.status).toBe('pending_review');
    expect(set.autoApproved).toBe(false);
    expect(set.approvedBy).toBeNull();
    expect(set.approvedAt).toBeNull();
    expect(set.payload).toMatchObject({ name: 'Vinagreta de la casa' });
  });

  // SAFETY: the one path to `approved` with no human behind it. It must record
  // that fact rather than forging a signature.
  it('publishes with no approver recorded in auto_publish', async () => {
    arrange({ mode: 'auto_publish' });
    await autoTranslateOnPublish(RECIPE, ACTOR);

    const set = writtenSet();
    expect(set.status).toBe('approved');
    expect(set.autoApproved).toBe(true);
    expect(set.approvedBy).toBeNull();
    expect(set.approvedAt).toBeInstanceOf(Date);
    // The actor is who set the version live, not who reviewed the Spanish.
    expect(String(set.requestedBy)).toBe(ACTOR);
  });

  it('skips a recipe with no live version', async () => {
    const { parse } = arrange({ recipe: head({ activeVersionId: null }) });
    await autoTranslateOnPublish(RECIPE, ACTOR);
    expect(parse).not.toHaveBeenCalled();
    expect(RecipeTranslation.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('skips an archived recipe', async () => {
    const { parse } = arrange({ recipe: head({ status: 'archived' }) });
    await autoTranslateOnPublish(RECIPE, ACTOR);
    expect(parse).not.toHaveBeenCalled();
  });

  // Re-activating the same version, or a second trigger for the same text,
  // must not spend money or overwrite a chef's reviewed edits.
  it('skips when a translation already covers exactly this source', async () => {
    const sourceHash = sourceHashOf(translatableProjection('House Vinaigrette', CONTENT as never));
    const { parse } = arrange({
      existingTranslation: { sourceVersionId: VERSION, sourceHash },
    });

    await autoTranslateOnPublish(RECIPE, ACTOR);
    expect(parse).not.toHaveBeenCalled();
    expect(RecipeTranslation.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('re-translates when the existing translation covers an older version', async () => {
    arrange({
      existingTranslation: { sourceVersionId: new Types.ObjectId(), sourceHash: 'stale-hash' },
    });
    await autoTranslateOnPublish(RECIPE, ACTOR);
    expect(RecipeTranslation.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  // Two activations in quick succession: the first run must not stamp text for
  // a version staff no longer read — under auto_publish it would stamp it
  // *approved*.
  it('discards its result when another version went live mid-call', async () => {
    arrange({ afterLlm: { name: 'House Vinaigrette', activeVersionId: new Types.ObjectId() } });
    await autoTranslateOnPublish(RECIPE, ACTOR);
    expect(RecipeTranslation.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('discards its result when the recipe was renamed mid-call', async () => {
    arrange({ afterLlm: { name: 'Renamed Vinaigrette', activeVersionId: VERSION } });
    await autoTranslateOnPublish(RECIPE, ACTOR);
    expect(RecipeTranslation.findOneAndUpdate).not.toHaveBeenCalled();
  });

  // Nothing awaits this function: a throw would be an unhandled rejection, and
  // a failed translation must never look like a failed publish.
  it('swallows an LLM failure', async () => {
    arrange();
    vi.mocked(anthropic).mockReturnValue({
      messages: { parse: vi.fn().mockRejectedValue(new Error('502 from upstream')) },
    } as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(autoTranslateOnPublish(RECIPE, ACTOR)).resolves.toBeUndefined();
    expect(RecipeTranslation.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('does nothing when the server has translation switched off', async () => {
    Object.assign(env, { translationEnabled: false });
    const { parse } = arrange();
    await autoTranslateOnPublish(RECIPE, ACTOR);
    expect(parse).not.toHaveBeenCalled();
  });

  // The org's language list decides what gets translated at all — an
  // English-only org is not silently paying for Spanish.
  it('translates nothing when the org does not publish Spanish', async () => {
    arrange();
    vi.mocked(Organization.findById).mockReturnValue(
      selectLean({
        settings: { translationPublishMode: 'auto_publish' },
        locales: ['en'],
      }) as never,
    );

    await autoTranslateOnPublish(RECIPE, ACTOR);
    expect(RecipeTranslation.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
