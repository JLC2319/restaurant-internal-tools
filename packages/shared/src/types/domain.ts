/**
 * Domain constants and types shared by @rit/api and @rit/web.
 *
 * Every enum in the system is declared here as a `const` array first and the
 * union type is derived from it. That array is the single source of truth —
 * Mongoose `enum:` options and Zod `z.enum()` calls both read from it, so a
 * value can never drift between validation, storage, and the UI.
 */

// ── Tenancy ───────────────────────────────────────────────────────────────────

/**
 * The three tiers of the account hierarchy, from the planning doc:
 * Organization (parent company) → Independent Property → Location.
 * Each tier is a separately billed seat.
 */
export const tenantTierValues = ['org', 'property', 'location'] as const;
export type TenantTier = (typeof tenantTierValues)[number];

/**
 * A member's role *within a scope*. Ordered from most to least privileged —
 * `roleRank` below depends on this order, so only ever append to the low-
 * privilege end or you will silently widen everyone's permissions.
 */
export const tenantRoleValues = ['owner', 'admin', 'director', 'manager', 'chef', 'staff'] as const;
export type TenantRole = (typeof tenantRoleValues)[number];

/** Numeric rank for role comparisons. Lower number = more privileged. */
export const roleRank: Record<TenantRole, number> = {
  owner: 0,
  admin: 1,
  director: 2,
  manager: 3,
  chef: 4,
  staff: 5,
};

/** True when `role` is at least as privileged as `minimum`. */
export function roleAtLeast(role: TenantRole, minimum: TenantRole): boolean {
  return roleRank[role] <= roleRank[minimum];
}

export const membershipStatusValues = ['invited', 'active', 'revoked'] as const;
export type MembershipStatus = (typeof membershipStatusValues)[number];

export const tenantStatusValues = ['active', 'suspended', 'archived'] as const;
export type TenantStatus = (typeof tenantStatusValues)[number];

/**
 * The scope stamped on every tenant-owned document. `propertyId` and
 * `locationId` are `null` — never absent — when the document lives higher up
 * the tree. See `scopeReadFilter` in the API: the read filters use
 * `$in: [null, id]`, which a missing field would not match.
 */
export interface TenantScope {
  orgId: string;
  propertyId: string | null;
  locationId: string | null;
}

/** The caller's resolved position in the hierarchy for the current request. */
export interface TenantContext extends TenantScope {
  role: TenantRole;
  /** Which tier the caller's membership sits at. Drives what they may write. */
  tier: TenantTier;
  /** Platform staff bypass — set for `superAdmin` users, never for customers. */
  isPlatformAdmin: boolean;
}

// ── Platform users ────────────────────────────────────────────────────────────

/**
 * Role on the platform itself, distinct from `TenantRole`. Almost every user
 * is a plain `user`; `superAdmin` is us, for support and provisioning.
 */
export const platformRoleValues = ['user', 'superAdmin'] as const;
export type PlatformRole = (typeof platformRoleValues)[number];

export const userStatusValues = ['active', 'suspended'] as const;
export type UserStatus = (typeof userStatusValues)[number];

export interface UserName {
  first: string;
  last: string;
}

// ── Localisation ──────────────────────────────────────────────────────────────

/**
 * Locales the app translates between. English is always the authoring locale;
 * everything else is a translation that must clear the review gate.
 */
export const localeValues = ['en', 'es'] as const;
export type Locale = (typeof localeValues)[number];

/** The locale content is authored in. Never machine-translated. */
export const SOURCE_LOCALE: Locale = 'en';

// ── Review / approval gate ────────────────────────────────────────────────────

/**
 * The human approval gate required by the planning doc for anything a machine
 * produced or anything carrying food-safety liability — LLM translations and
 * allergen tags above all. Nothing reaches kitchen staff at `draft` or
 * `pending_review`; only `approved` content is publishable.
 */
export const approvalStatusValues = ['draft', 'pending_review', 'approved', 'rejected'] as const;
export type ApprovalStatus = (typeof approvalStatusValues)[number];

/** The only status that may be shown to kitchen staff on the reader app. */
export const PUBLISHABLE_STATUS: ApprovalStatus = 'approved';

/** Who or what produced a piece of content. Drives the "machine translated" UI badge. */
export const contentOriginValues = ['human', 'machine', 'machine_edited'] as const;
export type ContentOrigin = (typeof contentOriginValues)[number];

// ── Allergens & dietary ───────────────────────────────────────────────────────

/**
 * Allergen tags. The first nine are the FDA major allergens; the rest are
 * common enough in back-of-house allergen sheets to be worth structuring.
 *
 * SAFETY: this list is exclusion-based. The allergen lookup answers "which
 * dishes must this guest avoid", so an *absent* tag is a claim of safety.
 * Never let a tag be set by anything but a human sign-off — see
 * `ApprovalStatus` and the liability notes in AGENTS.md.
 */
export const allergenValues = [
  'milk',
  'eggs',
  'fish',
  'shellfish',
  'tree_nuts',
  'peanuts',
  'wheat',
  'soybeans',
  'sesame',
  'gluten',
  'mustard',
  'celery',
  'sulphites',
  'lupin',
  'molluscs',
  'alcohol',
  'pork',
] as const;
export type Allergen = (typeof allergenValues)[number];

export const dietaryValues = [
  'vegetarian',
  'vegan',
  'pescatarian',
  'gluten_free',
  'dairy_free',
  'nut_free',
  'halal',
  'kosher',
  'keto',
  'low_sodium',
] as const;
export type Dietary = (typeof dietaryValues)[number];

// ── Recipes ───────────────────────────────────────────────────────────────────

/**
 * Lifecycle of a recipe lineage. Archiving is soft — versions and the working
 * copy survive so history stays browsable — and is reversible. There is no
 * `suspended`: that concept belongs to tenants, not recipes.
 */
export const recipeStatusValues = ['active', 'archived'] as const;
export type RecipeStatus = (typeof recipeStatusValues)[number];

/**
 * An ingredient line is either a raw item (free-text name) or a reference to
 * another recipe — sub-recipes are recipes. A `recipe` line points at the
 * lineage id, not a specific version; consumers follow that lineage's active
 * version.
 */
export const ingredientKindValues = ['item', 'recipe'] as const;
export type IngredientKind = (typeof ingredientKindValues)[number];

// ── Media ─────────────────────────────────────────────────────────────────────

/**
 * What an asset is. Photos are stored as uploaded and are readable the moment
 * the upload returns; video needs a transcode step it must not block on, which
 * is what `processing` below exists for.
 */
export const mediaKindValues = ['photo', 'video'] as const;
export type MediaKind = (typeof mediaKindValues)[number];

/**
 * Delivery readiness. A photo is `ready` on insert. Video lands `processing`
 * and the reader app renders that state rather than a broken player.
 */
export const mediaStatusValues = ['ready', 'processing', 'failed'] as const;
export type MediaStatus = (typeof mediaStatusValues)[number];

/**
 * Image formats accepted for plating photos. This is matched against the
 * *sniffed* bytes of the upload, never the client's `Content-Type` header or
 * filename — see `sniffImage` in the API. HEIC is deliberately absent: iOS
 * converts to JPEG on upload from Safari, and decoding it server-side would
 * mean a native dependency.
 */
export const imageMimeValues = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMime = (typeof imageMimeValues)[number];

/**
 * Plating photos per recipe. A generous ceiling for "the dish, plus a couple of
 * build steps" that still bounds the reader app's payload on kitchen wifi.
 */
export const MAX_RECIPE_PHOTOS = 8;

/** Upload ceiling for a single photo, in bytes. Modern phone photos land ~3–6MB. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

// ── Measurement ───────────────────────────────────────────────────────────────

/** Unit families. Conversions are only ever sound *within* a family. */
export const unitFamilyValues = ['weight', 'volume', 'count'] as const;
export type UnitFamily = (typeof unitFamilyValues)[number];

export const unitValues = [
  // weight
  'g',
  'kg',
  'oz',
  'lb',
  // volume
  'ml',
  'l',
  'tsp',
  'tbsp',
  'floz',
  'cup',
  'pt',
  'qt',
  'gal',
  // count / container
  'each',
  'case',
  'bunch',
  'clove',
  'can',
  'pkg',
] as const;
export type Unit = (typeof unitValues)[number];

export const unitFamily: Record<Unit, UnitFamily> = {
  g: 'weight',
  kg: 'weight',
  oz: 'weight',
  lb: 'weight',
  ml: 'volume',
  l: 'volume',
  tsp: 'volume',
  tbsp: 'volume',
  floz: 'volume',
  cup: 'volume',
  pt: 'volume',
  qt: 'volume',
  gal: 'volume',
  each: 'count',
  case: 'count',
  bunch: 'count',
  clove: 'count',
  can: 'count',
  pkg: 'count',
};
