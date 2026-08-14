import { Schema, model } from 'mongoose';
import type { IRecipeVersion, IScope } from '../../types/index';
import { recipeContentSchema } from './recipe.model';

/**
 * An immutable snapshot of a recipe's working copy, minted by "save as
 * version". No update path exists on purpose — history that can be rewritten
 * is not history. The scope is denormalised from the head so version queries
 * compose scopeReadFilter directly; that stays safe because scope mutates
 * only through `moveRecipe`, which rewrites these copies in the same act
 * (forking still creates a new head).
 *
 * ACCESS INVARIANT: the head's `access` allow-list is deliberately NOT
 * denormalised here — it mutates, so copies would go stale. Every read of a
 * version must therefore first load the head through `recipeAccessFilter`
 * (see recipeAccess.ts); a standalone RecipeVersion query is an ACL bypass by
 * construction.
 */

const scopeSchema = new Schema<IScope>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', default: null },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', default: null },
  },
  { _id: false }
);

const recipeVersionSchema = new Schema<IRecipeVersion>(
  {
    recipeId: { type: Schema.Types.ObjectId, ref: 'Recipe', required: true },
    version: { type: Number, required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    content: { type: recipeContentSchema, required: true },
    note: { type: String, trim: true, maxlength: 300 },
    scope: { type: scopeSchema, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } }
);

// Uniqueness is the concurrency backstop for version numbering: two racing
// "save as version" calls cannot both win the same number — the loser's 11000
// surfaces as the errorHandler's 409.
recipeVersionSchema.index({ recipeId: 1, version: 1 }, { unique: true });
// Active-snapshot reverse lookup for the archive guard, and the future
// allergens feature's sub-recipe tree resolution.
recipeVersionSchema.index({ 'scope.orgId': 1, 'content.ingredients.recipeId': 1 });

export const RecipeVersion = model<IRecipeVersion>('RecipeVersion', recipeVersionSchema);
