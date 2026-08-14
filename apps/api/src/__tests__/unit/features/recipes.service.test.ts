import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TenantContext } from '@rit/shared';
import { Types } from 'mongoose';

// Mocked with the same module ids the service resolves, per AGENTS §11.
vi.mock('../../../features/recipes/recipe.model', () => ({
  Recipe: {
    find: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    countDocuments: vi.fn(),
  },
}));
vi.mock('../../../features/recipes/recipeVersion.model', () => ({
  RecipeVersion: { find: vi.fn(), findOne: vi.fn(), findById: vi.fn(), create: vi.fn() },
}));
vi.mock('../../../features/tenancy/tenancy.service', () => ({
  resolveRecipePublishModeForScope: vi.fn(),
}));
vi.mock('../../../features/translations/translation.service', () => ({
  autoTranslateOnPublish: vi.fn().mockResolvedValue(undefined),
  beginAutoTranslation: vi.fn().mockResolvedValue(true),
  invalidateForActiveVersion: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../features/media/media.service', () => ({
  assertPhotosAttachable: vi.fn(),
  resolveAssets: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock('../../../features/tenancy/property.model', () => ({ Property: { exists: vi.fn() } }));
vi.mock('../../../features/tenancy/location.model', () => ({ Location: { exists: vi.fn() } }));

import { Recipe } from '../../../features/recipes/recipe.model';
import { RecipeVersion } from '../../../features/recipes/recipeVersion.model';
import { resolveRecipePublishModeForScope } from '../../../features/tenancy/tenancy.service';
import {
  autoTranslateOnPublish,
  beginAutoTranslation,
  invalidateForActiveVersion,
} from '../../../features/translations/translation.service';
import { resolveAssets } from '../../../features/media/media.service';
import {
  assertNoCycle,
  listRecipes,
  mergeAllergenTags,
  publishRecipe,
  saveVersion,
} from '../../../features/recipes/recipe.service';
import { AppError } from '../../../lib/AppError';
import type { IAllergenTag } from '../../../types/index';

const A = '507f1f77bcf86cd799439011';
const B = '507f1f77bcf86cd799439012';
const C = '507f1f77bcf86cd799439013';
const D = '507f1f77bcf86cd799439014';
const CALLER = '507f1f77bcf86cd799439099';

function ctx(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    userId: CALLER,
    orgId: 'org-1',
    propertyId: null,
    locationId: null,
    role: 'chef',
    tier: 'org',
    isPlatformAdmin: false,
    ...overrides,
  };
}

function recipeLine(recipeId: string) {
  return { kind: 'recipe', recipeId, quantity: { amount: 1, unit: 'qt' } };
}

/** A .find(...).select(...).lean() chain resolving to `result`. */
function findChain(result: unknown) {
  return { select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(result) }) };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('mergeAllergenTags', () => {
  const approved: IAllergenTag = {
    allergen: 'milk',
    status: 'approved',
    approvedBy: new Types.ObjectId(),
    approvedAt: new Date('2026-01-01'),
  };

  it('keeps an approved stamp when the ingredient list is unchanged', () => {
    const merged = mergeAllergenTags([approved], ['milk', 'eggs'], false);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ allergen: 'milk', status: 'approved' });
    expect(merged[0].approvedBy).toBe(approved.approvedBy);
    expect(merged[1]).toMatchObject({
      allergen: 'eggs',
      status: 'pending_review',
      approvedBy: null,
      approvedAt: null,
    });
  });

  it('drops tags no longer requested', () => {
    const merged = mergeAllergenTags([approved], [], false);
    expect(merged).toEqual([]);
  });

  // SAFETY: an approval was made against a specific composition — a changed
  // ingredient list invalidates every stamp, mirroring the translations rule.
  it('resets every tag when the ingredients changed', () => {
    const merged = mergeAllergenTags([approved], ['milk'], true);
    expect(merged[0]).toEqual({
      allergen: 'milk',
      status: 'pending_review',
      approvedBy: null,
      approvedAt: null,
    });
  });
});

describe('assertNoCycle', () => {
  it('rejects a direct self-reference without touching the database', async () => {
    await expect(assertNoCycle(ctx(), A, [recipeLine(A)])).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(Recipe.find).not.toHaveBeenCalled();
  });

  it('rejects A → B → A', async () => {
    vi.mocked(Recipe.find).mockReturnValue(
      findChain([
        { _id: B, workingCopy: { ingredients: [recipeLine(A)] }, activeVersionId: null },
      ]) as never
    );
    await expect(assertNoCycle(ctx(), A, [recipeLine(B)])).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('allows a diamond (A → B,C → D) — shared sub-recipes are not cycles', async () => {
    vi.mocked(Recipe.find)
      .mockReturnValueOnce(
        findChain([
          { _id: B, workingCopy: { ingredients: [recipeLine(D)] }, activeVersionId: null },
          { _id: C, workingCopy: { ingredients: [recipeLine(D)] }, activeVersionId: null },
        ]) as never
      )
      .mockReturnValueOnce(
        findChain([{ _id: D, workingCopy: { ingredients: [] }, activeVersionId: null }]) as never
      );

    await expect(
      assertNoCycle(ctx(), A, [recipeLine(B), recipeLine(C)])
    ).resolves.toBeUndefined();
  });

  // An active snapshot can reference recipes its current working copy no
  // longer does, and consumption resolves active versions — so the guard must
  // walk both.
  it('finds a cycle hidden in an active version', async () => {
    const versionId = new Types.ObjectId();
    vi.mocked(Recipe.find).mockReturnValue(
      findChain([{ _id: B, workingCopy: { ingredients: [] }, activeVersionId: versionId }]) as never
    );
    vi.mocked(RecipeVersion.find).mockReturnValue(
      findChain([{ content: { ingredients: [recipeLine(A)] } }]) as never
    );

    await expect(assertNoCycle(ctx(), A, [recipeLine(B)])).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});

describe('listRecipes', () => {
  function mockList(): { filter: () => Record<string, unknown> } {
    const captured: { value?: Record<string, unknown> } = {};
    vi.mocked(Recipe.find).mockImplementation(((filter: Record<string, unknown>) => {
      captured.value = filter;
      return {
        sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [] }) }) }),
      };
    }) as never);
    vi.mocked(Recipe.countDocuments).mockResolvedValue(0 as never);
    return { filter: () => captured.value! };
  }

  it('forces staff onto active, published recipes only', async () => {
    const captured = mockList();
    await listRecipes(ctx({ role: 'staff' }), { page: 1, limit: 25, status: 'archived' });
    expect(captured.filter()).toMatchObject({
      status: 'active',
      activeVersionId: { $ne: null },
    });
  });

  it('lets a chef browse unpublished and archived work', async () => {
    const captured = mockList();
    await listRecipes(ctx(), { page: 1, limit: 25, status: 'archived' });
    expect(captured.filter().status).toBe('archived');
    expect(captured.filter().activeVersionId).toBeUndefined();
  });
});

describe('saveVersion', () => {
  it('reserves the number atomically with $inc and snapshots the working copy', async () => {
    const workingCopy = { ingredients: [], allergens: [] };
    const scope = { orgId: 'org-1', propertyId: null, locationId: null };
    vi.mocked(Recipe.findOne).mockResolvedValue({ scope, status: 'active' } as never);
    vi.mocked(Recipe.findOneAndUpdate).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: A,
        name: 'Demi-glace',
        currentVersion: 4,
        activeVersionId: null,
        workingCopy,
        scope,
      }),
    } as never);
    vi.mocked(RecipeVersion.create).mockResolvedValue({
      toObject: () => ({
        _id: B,
        recipeId: A,
        version: 4,
        name: 'Demi-glace',
        note: 'richer stock',
        createdBy: C,
        createdAt: new Date('2026-08-01'),
      }),
    } as never);

    const summary = await saveVersion(ctx(), C, A, { note: 'richer stock' });

    expect(Recipe.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: A }),
      { $inc: { currentVersion: 1 } },
      { new: true }
    );
    expect(RecipeVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({ version: 4, content: workingCopy, scope })
    );
    expect(summary).toMatchObject({ version: 4, note: 'richer stock', isActive: false });
  });
});

describe('publishRecipe', () => {
  const SCOPE = { orgId: 'org-1', propertyId: null, locationId: null };

  /**
   * Wires up the mocked models for one publish of a never-live recipe.
   *
   * `Recipe.findOne` is answered in call order because the path uses it four
   * times with two different terminals: three `loadForWrite` reads that await
   * the document directly (publish → saveVersion → activateVersion), then the
   * `.lean()` read behind the final `getRecipe`.
   */
  function arrangePublish(): { save: ReturnType<typeof vi.fn> } {
    const save = vi.fn();
    const head = { scope: SCOPE, status: 'active', activeVersionId: null, save };
    const leanHead = {
      _id: A,
      name: 'Demi-glace',
      scope: SCOPE,
      status: 'active',
      currentVersion: 1,
      activeVersionId: B,
      activeVersion: 1,
      workingCopy: { ingredients: [], allergens: [], photoIds: [], dietary: [], steps: [], description: '', yield: { amount: 1, unit: 'qt' } },
      forkedFrom: null,
      createdBy: C,
      createdAt: new Date('2026-08-01'),
      modifiedAt: new Date('2026-08-01'),
    };

    vi.mocked(Recipe.findOne)
      .mockReturnValueOnce(head as never)
      .mockReturnValueOnce(head as never)
      .mockReturnValueOnce(head as never)
      .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(leanHead) } as never);
    vi.mocked(Recipe.findOneAndUpdate).mockReturnValue({
      lean: vi.fn().mockResolvedValue({ ...leanHead, activeVersionId: null, activeVersion: null }),
    } as never);
    vi.mocked(RecipeVersion.create).mockResolvedValue({
      toObject: () => ({
        _id: B,
        recipeId: A,
        version: 1,
        name: 'Demi-glace',
        note: null,
        createdBy: C,
        createdAt: new Date('2026-08-01'),
      }),
    } as never);
    vi.mocked(RecipeVersion.findOne).mockReturnValue({
      select: () => ({ lean: vi.fn().mockResolvedValue({ _id: B, version: 1 }) }),
    } as never);
    vi.mocked(RecipeVersion.findById).mockReturnValue({
      lean: vi.fn().mockResolvedValue({ _id: B, content: leanHead.workingCopy }),
    } as never);

    return { save };
  }

  // The global `beforeEach` resets every mock, implementations included, so the
  // ones this path *awaits* have to be re-armed here — an un-armed mock returns
  // undefined, and `undefined.catch(…)` is a very confusing way to fail.
  beforeEach(() => {
    vi.mocked(resolveRecipePublishModeForScope).mockResolvedValue('publish_on_save');
    vi.mocked(autoTranslateOnPublish).mockResolvedValue(undefined as never);
    // The claim runs first and gates the job; unarmed it returns undefined and
    // the translation would never be scheduled.
    vi.mocked(beginAutoTranslation).mockResolvedValue(true);
    vi.mocked(invalidateForActiveVersion).mockResolvedValue(undefined as never);
    vi.mocked(resolveAssets).mockResolvedValue(new Map());
  });

  it('mints a version, activates it, and fires the tenant auto-translation', async () => {
    const { save } = arrangePublish();

    const detail = await publishRecipe(ctx(), C, A, { approveAllergens: false });

    expect(RecipeVersion.create).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }));
    expect(save).toHaveBeenCalled();
    expect(detail.activeVersion).toBe(1);

    // The whole point of routing through `activateVersion` rather than setting
    // the pointer inline: publishing this way must do everything setting a
    // version live does, and firing the org/property/location translation
    // setting is part of that. `autoTranslateOnPublish` decides for itself what
    // the mode means — this only pins that it is asked.
    expect(beginAutoTranslation).toHaveBeenCalledWith(A);
    expect(autoTranslateOnPublish).toHaveBeenCalledWith(A, C);
  });

  it('refuses without touching anything when the scope is manual', async () => {
    vi.mocked(resolveRecipePublishModeForScope).mockResolvedValue('manual');
    vi.mocked(Recipe.findOne).mockReturnValueOnce({
      scope: SCOPE,
      status: 'active',
      activeVersionId: null,
    } as never);

    await expect(publishRecipe(ctx(), C, A, { approveAllergens: false })).rejects.toThrow(AppError);
    expect(RecipeVersion.create).not.toHaveBeenCalled();
    expect(autoTranslateOnPublish).not.toHaveBeenCalled();
  });

  it('refuses on a lineage that is already live', async () => {
    vi.mocked(Recipe.findOne).mockReturnValueOnce({
      scope: SCOPE,
      status: 'active',
      activeVersionId: B,
    } as never);

    await expect(publishRecipe(ctx(), C, A, { approveAllergens: false })).rejects.toThrow(AppError);
    expect(RecipeVersion.create).not.toHaveBeenCalled();
    expect(autoTranslateOnPublish).not.toHaveBeenCalled();
  });
});
