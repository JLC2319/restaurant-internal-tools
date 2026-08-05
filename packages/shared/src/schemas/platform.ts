import { z } from 'zod';
import { paginationSchema } from './common.js';
import {
  localeValues,
  platformRoleValues,
  tenantStatusValues,
  userStatusValues,
} from '../types/domain.js';

/**
 * Schemas for the platform console (apps/admin). Every route that accepts
 * these sits behind `requireSuperAdmin` — they act across tenants, so none of
 * them carry a scope.
 */

/** Pagination plus free-text search (org name/slug, or user name/email). */
export const platformListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(120).optional(),
});

/**
 * Platform-side org creation provisions on a customer's behalf, so the owner
 * is named by email rather than defaulting to the caller. The account must
 * already exist — there is no email sending yet, so no way to invite one.
 */
export const platformCreateOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  ownerEmail: z.email('Enter a valid email address').toLowerCase().trim(),
  locales: z.array(z.enum(localeValues)).default(['en', 'es']),
});

export const platformUpdateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    locales: z.array(z.enum(localeValues)).optional(),
    status: z.enum(tenantStatusValues).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes supplied' });

export const platformUpdateUserSchema = z
  .object({
    status: z.enum(userStatusValues).optional(),
    platformRole: z.enum(platformRoleValues).optional(),
    emailVerified: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes supplied' });

export type PlatformListQuery = z.infer<typeof platformListQuerySchema>;
export type PlatformCreateOrganizationInput = z.infer<typeof platformCreateOrganizationSchema>;
export type PlatformUpdateOrganizationInput = z.infer<typeof platformUpdateOrganizationSchema>;
export type PlatformUpdateUserInput = z.infer<typeof platformUpdateUserSchema>;
