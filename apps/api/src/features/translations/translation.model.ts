import { Schema, model } from 'mongoose';
import { approvalStatusValues, contentOriginValues, localeValues } from '@rit/shared';
import type { IRecipeTranslation, IScope } from '../../types/index';

/**
 * One recipe's translation into one locale. The payload carries *text only* —
 * every number, unit, photo and allergen tag renders from the source version,
 * so a translation can never disagree with the recipe about what is in the
 * dish. History note: the document is upserted per (recipe, locale); the
 * immutable record of what staff actually read lives in the source version
 * the `sourceVersionId` points at.
 *
 * SAFETY: nothing here is staff-visible until `status` is `approved` AND the
 * source pointers still match the live version — both checks live in
 * translation.service.ts, and the reader endpoint enforces them server-side.
 */

const scopeSchema = new Schema<IScope>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', default: null },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', default: null },
  },
  { _id: false },
);

const payloadSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, default: '', maxlength: 3000 },
    ingredients: [
      new Schema(
        {
          name: { type: String, trim: true, maxlength: 160, default: null },
          note: { type: String, trim: true, maxlength: 400, default: null },
        },
        { _id: false },
      ),
    ],
    steps: [{ type: String, trim: true, maxlength: 3000 }],
  },
  { _id: false },
);

const recipeTranslationSchema = new Schema<IRecipeTranslation>(
  {
    scope: { type: scopeSchema, required: true },
    recipeId: { type: Schema.Types.ObjectId, ref: 'Recipe', required: true },
    locale: { type: String, enum: localeValues, required: true },
    status: { type: String, enum: approvalStatusValues, required: true },
    origin: { type: String, enum: contentOriginValues, required: true },
    sourceVersionId: { type: Schema.Types.ObjectId, ref: 'RecipeVersion', required: true },
    sourceVersion: { type: Number, required: true },
    sourceHash: { type: String, required: true },
    payload: { type: payloadSchema, required: true },
    llmModel: { type: String, default: null },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    requestedAt: { type: Date, required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    // SAFETY: `approved` without a human behind it — reached by the scope's
    // `auto_publish` setting. Kept as its own field rather than inferred from
    // `approvedBy: null` so the distinction survives any future backfill, and
    // so every render path can badge the text as unreviewed.
    autoApproved: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } },
);

// One translation per recipe per locale — re-translating updates in place.
// Doubles as the concurrency backstop: two racing upserts collapse to one row.
recipeTranslationSchema.index({ recipeId: 1, locale: 1 }, { unique: true });
// Scoped reads ("this recipe's translation, in my scope").
recipeTranslationSchema.index({ 'scope.orgId': 1, recipeId: 1 });

export const RecipeTranslation = model<IRecipeTranslation>(
  'RecipeTranslation',
  recipeTranslationSchema,
);
