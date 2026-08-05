import { Schema, model } from 'mongoose';
import { localeValues, tenantStatusValues } from '@rit/shared';
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
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } }
);

export const Organization = model<IOrganization>('Organization', organizationSchema);
