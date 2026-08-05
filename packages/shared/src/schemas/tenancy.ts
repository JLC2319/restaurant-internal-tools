import { z } from 'zod';
import { objectIdSchema, slugSchema } from './common.js';
import { localeValues, tenantRoleValues, tenantStatusValues } from '../types/domain.js';

// ── Organization ──────────────────────────────────────────────────────────────

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  slug: slugSchema.optional(),
  /** Locales this org publishes in. `en` is implicit and always present. */
  locales: z.array(z.enum(localeValues)).default(['en', 'es']),
});

export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    locales: z.array(z.enum(localeValues)).optional(),
    status: z.enum(tenantStatusValues).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes supplied' });

// ── Property (the doc's "Independent Property") ───────────────────────────────

export const createPropertySchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  slug: slugSchema.optional(),
});

export const updatePropertySchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    status: z.enum(tenantStatusValues).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes supplied' });

// ── Location ──────────────────────────────────────────────────────────────────

export const addressSchema = z.object({
  line1: z.string().trim().max(160).optional(),
  line2: z.string().trim().max(160).optional(),
  city: z.string().trim().max(80).optional(),
  region: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().max(2).optional(),
});

export const createLocationSchema = z.object({
  propertyId: objectIdSchema,
  name: z.string().trim().min(2, 'Name is required').max(120),
  slug: slugSchema.optional(),
  /** IANA zone. Line checks and prep lists are day-bounded, so this is load-bearing. */
  timezone: z.string().trim().min(1).default('America/Chicago'),
  address: addressSchema.optional(),
});

export const updateLocationSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    timezone: z.string().trim().min(1).optional(),
    address: addressSchema.optional(),
    status: z.enum(tenantStatusValues).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes supplied' });

// ── Membership ────────────────────────────────────────────────────────────────

/**
 * Invite a user into one scope. Exactly one tier is implied by which ids are
 * present: neither → org, `propertyId` only → property, both → location. The
 * refine below rejects a `locationId` without its parent property, which would
 * otherwise produce a scope no read filter can match.
 */
export const inviteMemberSchema = z
  .object({
    email: z.email('Enter a valid email address').toLowerCase().trim(),
    role: z.enum(tenantRoleValues),
    propertyId: objectIdSchema.nullish(),
    locationId: objectIdSchema.nullish(),
  })
  .refine((v) => !v.locationId || !!v.propertyId, {
    message: 'A location-scoped membership must also name its property',
    path: ['propertyId'],
  });

export const updateMembershipSchema = z.object({
  role: z.enum(tenantRoleValues),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;
export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type AddressInput = z.infer<typeof addressSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>;
