import { Schema, model } from 'mongoose';
import { localeValues, tenantStatusValues } from '@rit/shared';
import { orgSettingsSchema } from './tenantSettings.model';
import type { IOrganization } from '../../types/index';

/**
 * The top of the hierarchy — a parent restaurant company. Billed as a seat.
 * Everything else in the database hangs off an org id; there is no data in
 * this system that does not belong to exactly one org.
 */
const organizationSchema = new Schema<IOrganization>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    status: { type: String, enum: tenantStatusValues, default: 'active' },
    locales: {
      type: [{ type: String, enum: localeValues }],
      default: ['en', 'es'],
    },
    settings: { type: orgSettingsSchema, default: () => ({}) },
    logoMediaId: { type: Schema.Types.ObjectId, ref: 'Media', default: null },
    address: {
      line1: { type: String, trim: true },
      line2: { type: String, trim: true },
      city: { type: String, trim: true },
      region: { type: String, trim: true },
      postalCode: { type: String, trim: true },
      country: { type: String, trim: true, maxlength: 2 },
    },
    contact: {
      phone: { type: String, trim: true, maxlength: 40, default: null },
      email: { type: String, trim: true, lowercase: true, default: null },
      website: { type: String, trim: true, maxlength: 200, default: null },
    },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } }
);

export const Organization = model<IOrganization>('Organization', organizationSchema);
