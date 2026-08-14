import { Schema, model } from 'mongoose';
import { mediaKindValues, mediaStatusValues } from '@rit/shared';
import type { IMedia, IScope } from '../../types/index';

/**
 * The tenant-scoped index of everything in object storage. The bytes live in
 * R2; this collection is what makes an asset findable, scopeable and
 * revocable — nothing reads the bucket directly.
 *
 * Assets are scoped like any other document, so a location's plating photo is
 * invisible to a sibling location even if someone guesses its id.
 */

const scopeSchema = new Schema<IScope>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', default: null },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', default: null },
  },
  { _id: false },
);

const mediaSchema = new Schema<IMedia>(
  {
    scope: { type: scopeSchema, required: true },
    kind: { type: String, enum: mediaKindValues, required: true },
    status: { type: String, enum: mediaStatusValues, default: 'ready' },
    // Unique because the key is minted from random bytes: a collision would
    // otherwise silently overwrite another tenant's object.
    key: { type: String, required: true, unique: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } },
);

// The only query shape this collection serves: "resolve these ids, in my scope".
mediaSchema.index({ 'scope.orgId': 1, kind: 1, createdAt: -1 });

export const Media = model<IMedia>('Media', mediaSchema);
