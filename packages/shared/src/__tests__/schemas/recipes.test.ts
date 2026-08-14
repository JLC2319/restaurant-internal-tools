import { describe, it, expect } from 'vitest';
import {
  createRecipeSchema,
  forkRecipeSchema,
  ingredientLineSchema,
  listRecipesQuerySchema,
  publishRecipeSchema,
  recipeAccessSchema,
  recipeContentSchema,
  updateRecipeAccessSchema,
  updateRecipeSchema,
} from '../../schemas/recipes.js';
import { MAX_RECIPE_PHOTOS } from '../../types/domain.js';

const OID = '507f1f77bcf86cd799439011';
const OTHER_OID = '507f1f77bcf86cd799439012';

const QUANTITY = { amount: 2, unit: 'qt' };

describe('ingredientLineSchema', () => {
  it('accepts a raw item line', () => {
    const result = ingredientLineSchema.safeParse({
      kind: 'item',
      name: 'Yellow onion',
      quantity: QUANTITY,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a sub-recipe line', () => {
    const result = ingredientLineSchema.safeParse({
      kind: 'recipe',
      recipeId: OID,
      quantity: QUANTITY,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an item line without a name', () => {
    const result = ingredientLineSchema.safeParse({ kind: 'item', quantity: QUANTITY });
    expect(result.success).toBe(false);
  });

  it('rejects a recipe line without a recipeId', () => {
    const result = ingredientLineSchema.safeParse({ kind: 'recipe', quantity: QUANTITY });
    expect(result.success).toBe(false);
  });

  it('rejects a unit outside the shared enum', () => {
    const result = ingredientLineSchema.safeParse({
      kind: 'item',
      name: 'Flour',
      quantity: { amount: 1, unit: 'scoops' },
    });
    expect(result.success).toBe(false);
  });
});

describe('recipeContentSchema', () => {
  it('rejects a non-positive yield — "0 quarts" is not a recipe', () => {
    const result = recipeContentSchema.safeParse({ yield: { amount: 0, unit: 'qt' } });
    expect(result.success).toBe(false);
  });

  it('defaults the collections so a minimal body round-trips complete', () => {
    const result = recipeContentSchema.safeParse({ yield: QUANTITY });
    expect(result.success).toBe(true);
    expect(result.data?.ingredients).toEqual([]);
    expect(result.data?.steps).toEqual([]);
    expect(result.data?.allergens).toEqual([]);
    expect(result.data?.dietary).toEqual([]);
    expect(result.data?.photoIds).toEqual([]);
    expect(result.data?.description).toBe('');
  });

  it('keeps plating photo order — index 0 is the hero shot', () => {
    const photoIds = [OID, OTHER_OID];
    const result = recipeContentSchema.safeParse({ yield: QUANTITY, photoIds });
    expect(result.success).toBe(true);
    expect(result.data?.photoIds).toEqual(photoIds);
  });

  it('rejects a photo id that is not an ObjectId', () => {
    const result = recipeContentSchema.safeParse({ yield: QUANTITY, photoIds: ['not-an-id'] });
    expect(result.success).toBe(false);
  });

  it('caps plating photos at MAX_RECIPE_PHOTOS', () => {
    const photoIds = Array.from({ length: MAX_RECIPE_PHOTOS + 1 }, () => OID);
    const result = recipeContentSchema.safeParse({ yield: QUANTITY, photoIds });
    expect(result.success).toBe(false);
  });
});

describe('createRecipeSchema', () => {
  // The same rule as memberships: a location without its parent property is a
  // scope no read filter can ever match.
  it('rejects a locationId without its property', () => {
    const result = createRecipeSchema.safeParse({
      name: 'Demi-glace',
      content: { yield: QUANTITY },
      locationId: OID,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['propertyId']);
  });

  it('accepts a fully-scoped create', () => {
    const result = createRecipeSchema.safeParse({
      name: 'Demi-glace',
      content: { yield: QUANTITY },
      propertyId: OID,
      locationId: OTHER_OID,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an optional allow-list so a recipe can be born restricted', () => {
    const result = createRecipeSchema.safeParse({
      name: 'House sauce',
      content: { yield: QUANTITY },
      access: { userIds: [OID] },
    });
    expect(result.success).toBe(true);
    expect(result.data?.access?.userIds).toEqual([OID]);
  });
});

describe('recipeAccessSchema', () => {
  it('defaults userIds so an empty object is a valid (empty) list', () => {
    const result = recipeAccessSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data?.userIds).toEqual([]);
  });

  it('rejects a userId that is not an ObjectId', () => {
    const result = recipeAccessSchema.safeParse({ userIds: ['not-an-id'] });
    expect(result.success).toBe(false);
  });

  it('caps the list at 200 — beyond that it should be a scope, not an ACL', () => {
    const userIds = Array.from({ length: 201 }, () => OID);
    const result = recipeAccessSchema.safeParse({ userIds });
    expect(result.success).toBe(false);
  });
});

describe('updateRecipeAccessSchema', () => {
  it('accepts null to clear the restriction', () => {
    const result = updateRecipeAccessSchema.safeParse({ access: null });
    expect(result.success).toBe(true);
    expect(result.data?.access).toBeNull();
  });

  it('accepts a replacement list', () => {
    const result = updateRecipeAccessSchema.safeParse({ access: { userIds: [OID, OTHER_OID] } });
    expect(result.success).toBe(true);
    expect(result.data?.access?.userIds).toEqual([OID, OTHER_OID]);
  });

  it('rejects a body missing the access key — clearing must be explicit', () => {
    const result = updateRecipeAccessSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('updateRecipeSchema', () => {
  it('rejects an empty update', () => {
    const result = updateRecipeSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('No changes supplied');
  });

  it('accepts a rename alone', () => {
    const result = updateRecipeSchema.safeParse({ name: 'Glace de viande' });
    expect(result.success).toBe(true);
  });
});

describe('forkRecipeSchema', () => {
  it('rejects a locationId without its property', () => {
    const result = forkRecipeSchema.safeParse({ locationId: OID });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['propertyId']);
  });
});

describe('publishRecipeSchema', () => {
  it('defaults the allergen sign-off to off', () => {
    // The safe default: publishing and signing off are separate claims, and an
    // omitted field must never be read as a chef having made the second one.
    const result = publishRecipeSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data?.approveAllergens).toBe(false);
  });

  it('carries an explicit sign-off and an optional note', () => {
    const result = publishRecipeSchema.safeParse({ approveAllergens: true, note: 'Opening menu' });
    expect(result.success).toBe(true);
    expect(result.data?.approveAllergens).toBe(true);
    expect(result.data?.note).toBe('Opening menu');
  });

  it('rejects a non-boolean sign-off rather than coercing it', () => {
    // 'false' is truthy, and a coerced string here would forge a signature.
    expect(publishRecipeSchema.safeParse({ approveAllergens: 'false' }).success).toBe(false);
  });
});

describe('listRecipesQuerySchema', () => {
  it('coerces query strings and defaults the status', () => {
    const result = listRecipesQuerySchema.safeParse({ page: '2', limit: '10' });
    expect(result.success).toBe(true);
    expect(result.data?.page).toBe(2);
    expect(result.data?.limit).toBe(10);
    expect(result.data?.status).toBe('active');
  });

  it('caps the limit so a client cannot ask for the whole collection', () => {
    const result = listRecipesQuerySchema.safeParse({ limit: '5000' });
    expect(result.success).toBe(false);
  });
});
