import { Schema, model } from 'mongoose';
import { tenantStatusValues } from '@rit/shared';
import { settingsOverrideSchema } from './tenantSettings.model';
import type { ILocation } from '../../types/index';

/**
 * An individual operating unit — one restaurant. Billed as a seat, and the
 * level at which line checks, prep lists and batch records will live.
 *
 * `orgId` is denormalised from the parent property so that every scope filter
 * can start at the org without a join. The two must never disagree; only
 * `createLocation` writes them, and it copies the org from the property.
 */
const locationSchema = new Schema<ILocation>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, lowercase: true, trim: true },
    timezone: { type: String, required: true, default: 'America/Chicago' },
    address: {
      line1: { type: String, trim: true },
      line2: { type: String, trim: true },
      city: { type: String, trim: true },
      region: { type: String, trim: true },
      postalCode: { type: String, trim: true },
      country: { type: String, trim: true, maxlength: 2 },
    },
    status: { type: String, enum: tenantStatusValues, default: 'active' },
    /** Overrides of the property's (then org's) settings; `null` fields inherit. */
    settings: { type: settingsOverrideSchema, default: () => ({}) },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } }
);

locationSchema.index({ orgId: 1, slug: 1 }, { unique: true });

export const Location = model<ILocation>('Location', locationSchema);
