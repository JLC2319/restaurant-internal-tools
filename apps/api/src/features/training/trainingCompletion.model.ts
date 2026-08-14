import { Schema, model } from 'mongoose';
import type { ITrainingCompletion } from '../../types/index';

/**
 * One person finished one module in one location context — per user *per
 * location*, as the feature README specifies, because these records seed the
 * Phase 2 productivity tracking. A floater who completes the same module at
 * two locations legitimately produces two rows.
 *
 * The tenant ids are flat rather than a `scope` subdoc: a completion is not
 * scoped content that flows down the tree, it is a fact about where the person
 * was working (`null` location for org- and property-wide members). Reads
 * hand-roll their narrowing accordingly — see `completionReadFilter` in the
 * service.
 */

const trainingCompletionSchema = new Schema<ITrainingCompletion>(
  {
    trainingId: { type: Schema.Types.ObjectId, ref: 'TrainingModule', required: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', default: null },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', default: null },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    completedAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } },
);

// One completion per person per location context; the upsert in the service
// races against this, so a double-tap can never create two rows.
trainingCompletionSchema.index({ trainingId: 1, userId: 1, locationId: 1 }, { unique: true });
// "Which of this page of modules has this user completed?" — the list query.
trainingCompletionSchema.index({ orgId: 1, userId: 1, trainingId: 1 });

export const TrainingCompletion = model<ITrainingCompletion>(
  'TrainingCompletion',
  trainingCompletionSchema,
);
