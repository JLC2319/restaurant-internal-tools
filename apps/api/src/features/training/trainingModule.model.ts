import { Schema, model } from 'mongoose';
import {
  MAX_TRAINING_TEXT_CHARS,
  trainingBlockKindValues,
  trainingStatusValues,
} from '@rit/shared';
import type { IScope, ITrainingBlock, ITrainingModule } from '../../types/index';

/**
 * A training module: ordered polymorphic content blocks (text, image, video,
 * embed) behind a publish gate. Unlike recipes there is no version history —
 * a module is edited in place and `status: 'published'` is the entire
 * staff-visibility rule.
 *
 * Media blocks store asset *references*; the binaries live in R2 via the media
 * feature, never inline (see the feature README).
 */

const scopeSchema = new Schema<IScope>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', default: null },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', default: null },
  },
  { _id: false }
);

/**
 * One loose sub-schema for all block kinds, discriminated by Zod at the
 * boundary — the same pattern as ingredient lines. Only the fields for the
 * block's `kind` are ever set.
 */
const blockSchema = new Schema<ITrainingBlock>(
  {
    kind: { type: String, enum: trainingBlockKindValues, required: true },
    // The rich-text document. Mixed because its recursive shape is enforced
    // by richTextDocSchema at the boundary — Mongoose only stores it.
    doc: { type: Schema.Types.Mixed, default: undefined },
    // Legacy plain-text bodies from before rich text; read-only fallback.
    body: { type: String, trim: true, maxlength: MAX_TRAINING_TEXT_CHARS },
    mediaId: { type: Schema.Types.ObjectId, ref: 'Media', default: null },
    url: { type: String, trim: true, maxlength: 500 },
    caption: { type: String, trim: true, maxlength: 300 },
  },
  { _id: false }
);

const trainingModuleSchema = new Schema<ITrainingModule>(
  {
    scope: { type: scopeSchema, required: true },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, trim: true, default: '', maxlength: 500 },
    status: { type: String, enum: trainingStatusValues, default: 'draft' },
    blocks: { type: [blockSchema], default: [] },
    publishedAt: { type: Date, default: null },
    // Optional person-level allow-list narrowing visibility *within* the
    // scope — same contract as recipes (see tenancy/personAccess.ts): null,
    // and on pre-feature documents absent, means everyone in scope, so no
    // backfill. No index: gated queries are _id-keyed or bounded by the
    // org-prefixed list index below.
    access: {
      type: new Schema(
        { userIds: [{ type: Schema.Types.ObjectId, ref: 'User' }] },
        { _id: false }
      ),
      default: null,
    },
    // Set before the detached translation job starts and cleared when it
    // finishes, so the module page can show "translating…" instead of a button
    // that would start the same work twice. See trainingTranslation.service.
    autoTranslation: {
      type: new Schema(
        {
          status: { type: String, enum: ['running', 'failed'], required: true },
          startedAt: { type: Date, required: true },
        },
        { _id: false }
      ),
      default: null,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } }
);

// Scoped list queries: filter by org + status, sort/search on title.
trainingModuleSchema.index({ 'scope.orgId': 1, status: 1, title: 1 });

export const TrainingModule = model<ITrainingModule>('TrainingModule', trainingModuleSchema);
