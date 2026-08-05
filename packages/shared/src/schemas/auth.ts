import { z } from 'zod';
import { localeValues } from '../types/domain.js';

const nameSchema = z.object({
  first: z.string().trim().min(1, 'First name is required').max(60),
  last: z.string().trim().min(1, 'Last name is required').max(60),
});

/**
 * Password floor. Deliberately length-first rather than a character-class
 * gauntlet — back-of-house staff type these on a shared iPad, and complexity
 * rules there produce sticky notes on the pass, not stronger passwords.
 */
const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128);

export const registerSchema = z.object({
  name: nameSchema,
  email: z.email('Enter a valid email address').toLowerCase().trim(),
  password: passwordSchema,
  preferredLocale: z.enum(localeValues).default('en'),
});

export const loginSchema = z.object({
  email: z.email('Enter a valid email address').toLowerCase().trim(),
  password: z.string().min(1, 'Password is required'),
});

export const updateMeSchema = z
  .object({
    name: nameSchema.optional(),
    preferredLocale: z.enum(localeValues).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes supplied' });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
