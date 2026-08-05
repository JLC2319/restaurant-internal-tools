import { z } from 'zod';
import { objectIdSchema, paginationSchema } from './common.js';
import {
  MAX_RECIPE_PHOTOS,
  allergenValues,
  dietaryValues,
  recipeStatusValues,
  unitValues,
} from '../types/domain.js';

// ── Building blocks ───────────────────────────────────────────────────────────

/** A measured amount. Never a bare number — "12" is meaningless without "quarts". */
export const quantitySchema = z.object({
  amount: z.number().positive(),
  unit: z.enum(unitValues),
});

/**
 * One ingredient line: a raw item, or a reference to another recipe (a
 * sub-recipe — a batch of demi-glace is a recipe another recipe consumes).
 * `recipeId` points at the lineage, not a version; consumers follow the
 * referenced recipe's active version.
 */
export const ingredientLineSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('item'),
    name: z.string().trim().min(1, 'Ingredient name is required').max(120),
    quantity: quantitySchema,
    note: z.string().trim().max(300).optional(),
  }),
  z.object({
    kind: z.literal('recipe'),
    recipeId: objectIdSchema,
    quantity: quantitySchema,
    note: z.string().trim().max(300).optional(),
  }),
]);

/**
 * The editable body of a recipe (the working copy; versions snapshot it).
 * Clients submit `allergens` as a plain tag list — approval state
 * (status / approvedBy / approvedAt) is server-owned and never client-writable.
 *
 * `photoIds` are plating photos, ordered — index 0 is the hero shot the recipe
 * list and reader header use. They reference Media assets uploaded separately
 * via `/api/media`; the service checks every id is a readable photo in the
 * caller's scope before storing it. Photos live in the *content*, so a version
 * snapshots the plating it was saved with.
 */
export const recipeContentSchema = z.object({
  description: z.string().trim().max(2000).default(''),
  yield: quantitySchema,
  ingredients: z.array(ingredientLineSchema).max(200).default([]),
  steps: z.array(z.string().trim().min(1).max(2000)).max(100).default([]),
  allergens: z.array(z.enum(allergenValues)).default([]),
  dietary: z.array(z.enum(dietaryValues)).default([]),
  photoIds: z.array(objectIdSchema).max(MAX_RECIPE_PHOTOS).default([]),
  times: z
    .object({
      prepMinutes: z.number().int().min(0).optional(),
      cookMinutes: z.number().int().min(0).optional(),
    })
    .optional(),
});

// ── Requests ──────────────────────────────────────────────────────────────────

/**
 * Create a recipe lineage. `propertyId`/`locationId` optionally publish
 * downward from the caller's own scope; the same tier rule as memberships —
 * a location without its parent property is a scope no read filter can match.
 */
export const createRecipeSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required').max(120),
    content: recipeContentSchema,
    propertyId: objectIdSchema.nullish(),
    locationId: objectIdSchema.nullish(),
  })
  .refine((v) => !v.locationId || !!v.propertyId, {
    message: 'A location-scoped recipe must also name its property',
    path: ['propertyId'],
  });

export const updateRecipeSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    content: recipeContentSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes supplied' });

/** Freeze the working copy as the next numbered version. */
export const saveVersionSchema = z.object({
  note: z.string().trim().max(300).optional(),
});

/**
 * Fork a recipe into a new lineage at a target scope. `versionId` names the
 * source snapshot; omitted, the active version is used.
 */
export const forkRecipeSchema = z
  .object({
    versionId: objectIdSchema.optional(),
    name: z.string().trim().min(2).max(120).optional(),
    propertyId: objectIdSchema.nullish(),
    locationId: objectIdSchema.nullish(),
  })
  .refine((v) => !v.locationId || !!v.propertyId, {
    message: 'A location-scoped recipe must also name its property',
    path: ['propertyId'],
  });

/** Sign off allergen tags. Omitting `allergens` approves every pending tag. */
export const approveAllergensSchema = z.object({
  allergens: z.array(z.enum(allergenValues)).min(1).optional(),
});

export const listRecipesQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(120).optional(),
  status: z.enum(recipeStatusValues).default('active'),
});

export type QuantityInput = z.infer<typeof quantitySchema>;
export type IngredientLineInput = z.infer<typeof ingredientLineSchema>;
export type RecipeContentInput = z.infer<typeof recipeContentSchema>;
export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;
export type SaveVersionInput = z.infer<typeof saveVersionSchema>;
export type ForkRecipeInput = z.infer<typeof forkRecipeSchema>;
export type ApproveAllergensInput = z.infer<typeof approveAllergensSchema>;
export type ListRecipesQuery = z.infer<typeof listRecipesQuerySchema>;
