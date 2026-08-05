import { Schema, model } from 'mongoose';
import { localeValues, platformRoleValues, userStatusValues } from '@rit/shared';
import type { IUser } from '../../types/index';

/**
 * Every user query must apply this projection. `passwordHash` and the token
 * fields must never reach a response — see `SAFE_USER_FIELDS` usage in
 * auth.service.ts and the security notes in AGENTS.md.
 */
export const SAFE_USER_FIELDS =
  '-passwordHash -emailVerificationToken -passwordResetToken -passwordResetExpires';

const userSchema = new Schema<IUser>(
  {
    name: {
      first: { type: String, required: true, trim: true, maxlength: 60 },
      last: { type: String, required: true, trim: true, maxlength: 60 },
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true, select: false },
    emailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, select: false },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    platformRole: { type: String, enum: platformRoleValues, default: 'user' },
    status: { type: String, enum: userStatusValues, default: 'active' },
    preferredLocale: { type: String, enum: localeValues, default: 'en' },
    phone: { type: String, trim: true, maxlength: 40, default: null },
    jobTitle: { type: String, trim: true, maxlength: 80, default: null },
    lastLoginAt: { type: Date },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } }
);

export const User = model<IUser>('User', userSchema);
