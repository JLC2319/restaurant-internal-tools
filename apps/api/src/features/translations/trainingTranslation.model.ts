import { Schema, model } from 'mongoose';
import { approvalStatusValues, contentOriginValues, localeValues } from '@rit/shared';
import type { ITrainingTranslation, IScope } from '../../types/index';

/**
 * One training module's translation into one locale. The payload carries
 * *text only* — media assets, embeds and block structure render from the
 * source module, so a translation can never disagree with the module about
 * what it shows. Modules have no version history, so `sourceHash` alone is
 * the record of what text this translation was made from.
 *
 * SAFETY: nothing here is staff-visible until `status` is `approved` AND the
 * source hash still matches the module — both checks live in
 * trainingTranslation.service.ts, and the reader endpoint enforces them
 * server-side.
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
    title: { type: String, required: true, trim: true, maxlength: 180 },
    description: { type: String, trim: true, default: '', maxlength: 700 },
    blocks: [
      new Schema(
        {
          text: { type: String, trim: true, maxlength: 25000, default: null },
          caption: { type: String, trim: true, maxlength: 400, default: null },
        },
        { _id: false },
      ),
    ],
  },
  { _id: false },
);

const trainingTranslationSchema = new Schema<ITrainingTranslation>(
  {
    scope: { type: scopeSchema, required: true },
    trainingId: { type: Schema.Types.ObjectId, ref: 'TrainingModule', required: true },
    locale: { type: String, enum: localeValues, required: true },
    status: { type: String, enum: approvalStatusValues, required: true },
    origin: { type: String, enum: contentOriginValues, required: true },
    sourceHash: { type: String, required: true },
    payload: { type: payloadSchema, required: true },
    llmModel: { type: String, default: null },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    requestedAt: { type: Date, required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    // SAFETY: `approved` without a human behind it — reached by the scope's
    // `auto_publish` setting. See RecipeTranslation for the full rationale.
    autoApproved: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } },
);

// One translation per module per locale — re-translating updates in place.
// Doubles as the concurrency backstop: two racing upserts collapse to one row.
trainingTranslationSchema.index({ trainingId: 1, locale: 1 }, { unique: true });
// Scoped reads ("this module's translation, in my scope").
trainingTranslationSchema.index({ 'scope.orgId': 1, trainingId: 1 });

export const TrainingTranslation = model<ITrainingTranslation>(
  'TrainingTranslation',
  trainingTranslationSchema,
);
