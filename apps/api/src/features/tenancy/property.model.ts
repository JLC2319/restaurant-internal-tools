import { Schema, model } from 'mongoose';
import { tenantStatusValues } from '@rit/shared';
import type { IProperty } from '../../types/index';

/**
 * The planning doc's "Independent Property" — a brand or operating entity
 * under an org, holding the menus, trainings and recipes its locations share.
 * Billed as a seat.
 */
const propertySchema = new Schema<IProperty>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, lowercase: true, trim: true },
    status: { type: String, enum: tenantStatusValues, default: 'active' },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } }
);

// Slugs are unique per org, not globally — two orgs may both have a "flagship".
propertySchema.index({ orgId: 1, slug: 1 }, { unique: true });

export const Property = model<IProperty>('Property', propertySchema);
