import { Schema, model } from 'mongoose';
import {
  allergenValues,
  approvalStatusValues,
  dietaryValues,
  ingredientKindValues,
  recipeStatusValues,
  unitValues,
} from '@rit/shared';
import type { IRecipe, IRecipeContent, IScope } from '../../types/index';

/**
 * The recipe lineage head. Identity (`name`, `scope`, `status`) plus the one
 * mutable working copy chefs edit, and the pointer to the active version staff
 * cook from. Immutable history lives in the RecipeVersion collection.
 *
 * First model to embed the `scope` sub-document — see lib/scope.ts. A lineage's
 * scope never changes after insert; forking creates a new head instead.
 */

const scopeSchema = new Schema<IScope>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', default: null },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', default: null },
  },
  { _id: false }
);

const quantitySchema = new Schema(
  {
    amount: { type: Number, required: true },
    unit: { type: String, enum: unitValues, required: true },
  },
  { _id: false }
);

/**
 * The editable recipe body, shared verbatim between `Recipe.workingCopy` and
 * `RecipeVersion.content` so a snapshot is a plain copy. Ingredient lines are
 * discriminated by Zod at the boundary; Mongoose keeps one loose sub-schema.
 * Allergen approval stamps are server-written only — clients submit bare tags.
 */
export const recipeContentSchema = new Schema<IRecipeContent>(
  {
    description: { type: String, trim: true, default: '' },
    yield: { type: quantitySchema, required: true },
    ingredients: [
      new Schema(
        {
          kind: { type: String, enum: ingredientKindValues, required: true },
          name: { type: String, trim: true, maxlength: 120 },
          recipeId: { type: Schema.Types.ObjectId, ref: 'Recipe', default: null },
          quantity: { type: quantitySchema, required: true },
          note: { type: String, trim: true, maxlength: 300 },
        },
        { _id: false }
      ),
    ],
    steps: [{ type: String, trim: true }],
    allergens: [
      new Schema(
        {
          allergen: { type: String, enum: allergenValues, required: true },
          status: { type: String, enum: approvalStatusValues, required: true },
          approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
          approvedAt: { type: Date, default: null },
        },
        { _id: false }
      ),
    ],
    dietary: [{ type: String, enum: dietaryValues }],
    photoIds: { type: [Schema.Types.ObjectId], default: [] },
    times: {
      prepMinutes: { type: Number, min: 0 },
      cookMinutes: { type: Number, min: 0 },
    },
  },
  { _id: false }
);

const recipeSchema = new Schema<IRecipe>(
  {
    scope: { type: scopeSchema, required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    status: { type: String, enum: recipeStatusValues, default: 'active' },
    workingCopy: { type: recipeContentSchema, required: true },
    currentVersion: { type: Number, default: 0 },
    activeVersionId: { type: Schema.Types.ObjectId, ref: 'RecipeVersion', default: null },
    activeVersion: { type: Number, default: null },
    forkedFrom: {
      type: new Schema(
        {
          recipeId: { type: Schema.Types.ObjectId, ref: 'Recipe', required: true },
          versionId: { type: Schema.Types.ObjectId, ref: 'RecipeVersion', required: true },
          version: { type: Number, required: true },
        },
        { _id: false }
      ),
      default: null,
    },
    // Set before the detached translation job starts and cleared when it
    // finishes, so the recipe page can show "translating…" instead of a button
    // that would start the same work twice. See translation.service.
    autoTranslation: {
      type: new Schema(
        {
          status: { type: String, enum: ['running', 'failed'], required: true },
          startedAt: { type: Date, required: true },
          versionId: { type: Schema.Types.ObjectId, ref: 'RecipeVersion', default: null },
        },
        { _id: false }
      ),
      default: null,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } }
);

// Scoped list queries: filter by org + status, sort/search on name.
recipeSchema.index({ 'scope.orgId': 1, status: 1, name: 1 });
// Reverse lookup for the archive guard ("is anything using me as a sub-recipe?").
recipeSchema.index({ 'scope.orgId': 1, 'workingCopy.ingredients.recipeId': 1 });

export const Recipe = model<IRecipe>('Recipe', recipeSchema);
