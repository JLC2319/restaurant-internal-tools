import { Schema, model } from 'mongoose';
import { membershipStatusValues, tenantRoleValues } from '@rit/shared';
import type { IMembership } from '../../types/index';

/**
 * One row per user per scope. This is the *only* thing that grants access to
 * tenant data — there is no other path in, and `resolveTenant` reads nothing
 * else when deciding what a request may touch.
 *
 * `propertyId` / `locationId` are explicit `null` for a wider membership, so
 * the unique index below actually fires: Mongo treats two documents with a
 * *missing* field as distinct under a partial index but as equal when the
 * field is present and null.
 */
const membershipSchema = new Schema<IMembership>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', default: null },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', default: null },
    role: { type: String, enum: tenantRoleValues, required: true },
    status: { type: String, enum: membershipStatusValues, default: 'invited' },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    joinedAt: { type: Date },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } },
);

// A user holds at most one membership per exact scope. Two rows for the same
// scope would make `resolveTenant`'s "broadest wins" pick arbitrary.
membershipSchema.index({ userId: 1, orgId: 1, propertyId: 1, locationId: 1 }, { unique: true });

// Supports the per-org member list and the pending-invite count.
membershipSchema.index({ orgId: 1, status: 1 });

export const Membership = model<IMembership>('Membership', membershipSchema);
