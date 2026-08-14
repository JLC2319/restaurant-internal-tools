import { z } from 'zod';
import { objectIdSchema, slugSchema } from './common.js';
import {
  localeValues,
  recipePublishModeValues,
  tenantRoleValues,
  tenantStatusValues,
  translationPublishModeValues,
} from '../types/domain.js';

/** A postal address. Shared by locations and the org profile. */
export const addressSchema = z.object({
  line1: z.string().trim().max(160).optional(),
  line2: z.string().trim().max(160).optional(),
  city: z.string().trim().max(80).optional(),
  region: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().max(2).optional(),
});

/**
 * Org-level settings. The org sits at the root of the tree, so its values are
 * concrete: there is nothing above it to inherit from.
 */
export const tenantSettingsSchema = z.object({
  translationPublishMode: z.enum(translationPublishModeValues).optional(),
  recipePublishMode: z.enum(recipePublishModeValues).optional(),
});

/**
 * The same settings at a property or location, where `null` is a meaningful
 * value meaning "stop overriding, inherit from the parent again". Omitting the
 * key leaves the stored override alone; sending `null` clears it.
 */
export const tenantSettingsOverrideSchema = z.object({
  translationPublishMode: z.enum(translationPublishModeValues).nullable().optional(),
  recipePublishMode: z.enum(recipePublishModeValues).nullable().optional(),
});

// ── Organization ──────────────────────────────────────────────────────────────

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  slug: slugSchema.optional(),
  /** Locales this org publishes in. `en` is implicit and always present. */
  locales: z.array(z.enum(localeValues)).default(['en', 'es']),
});

/**
 * Public-facing org contact details. All clearable with `null`; clients
 * normalise empty inputs to `null` before sending, so `''` never validates.
 */
export const orgContactSchema = z.object({
  phone: z.string().trim().min(1).max(40).nullable().optional(),
  email: z.email('Enter a valid email address').toLowerCase().trim().nullable().optional(),
  website: z.url('Enter a valid URL (including https://)').max(200).nullable().optional(),
});

export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    locales: z.array(z.enum(localeValues)).optional(),
    status: z.enum(tenantStatusValues).optional(),
    /** `null` clears the logo; the id must be an org-owned photo asset. */
    logoMediaId: objectIdSchema.nullable().optional(),
    address: addressSchema.nullable().optional(),
    contact: orgContactSchema.optional(),
    settings: tenantSettingsSchema.optional(),
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
    settings: tenantSettingsOverrideSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes supplied' });

// ── Location ──────────────────────────────────────────────────────────────────

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
    settings: tenantSettingsOverrideSchema.optional(),
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

/**
 * Change a membership's role, its placement in the tree, or both. A placement
 * change is a FULL statement — send both ids, where null means the wider tier
 * (no property = org-wide). Omit both to leave placement untouched, so a
 * role-only patch stays exactly what it always was.
 */
export const updateMembershipSchema = z
  .object({
    role: z.enum(tenantRoleValues).optional(),
    propertyId: objectIdSchema.nullish(),
    locationId: objectIdSchema.nullish(),
  })
  .refine(
    (v) => v.role !== undefined || v.propertyId !== undefined || v.locationId !== undefined,
    { message: 'No changes supplied' }
  )
  .refine((v) => v.locationId == null || v.propertyId != null, {
    message: 'A location-scoped membership must also name its property',
    path: ['propertyId'],
  });

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;
export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type AddressInput = z.infer<typeof addressSchema>;
export type TenantSettingsInput = z.infer<typeof tenantSettingsSchema>;
export type TenantSettingsOverrideInput = z.infer<typeof tenantSettingsOverrideSchema>;
export type OrgContactInput = z.infer<typeof orgContactSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>;
