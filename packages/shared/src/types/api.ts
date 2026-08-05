import type {
  Locale,
  MembershipStatus,
  PlatformRole,
  TenantRole,
  TenantStatus,
  TenantTier,
  UserName,
  UserStatus,
} from './domain.js';

// ── Server response envelope ──────────────────────────────────────────────────

/** Generic server-side response envelope. */
export interface ApiResponse<T = unknown> {
  data: T;
  success: boolean;
  message?: string;
}

/** A page of results. Every list endpoint returns this shape. */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ── Client-side result type ───────────────────────────────────────────────────

/** Field-level validation error returned by the API. */
export interface ValidationError {
  field: string;
  message: string;
}

/** Error shape returned by the API on failure. */
export interface ApiError {
  message: string;
  errors?: ValidationError[];
}

/**
 * Discriminated union every client fetch function returns. Callers check
 * `result.error` first — never assume success.
 */
export type ApiResult<T> = { data: T; error: null } | { data: null; error: ApiError };

// ── Auth ──────────────────────────────────────────────────────────────────────

/** Minimal user shape returned inside auth responses. Never carries secrets. */
export interface AuthUser {
  _id: string;
  name: UserName;
  email: string;
  emailVerified: boolean;
  platformRole: PlatformRole;
  status: UserStatus;
  preferredLocale: Locale;
}

/** Response body from POST /api/auth/login. */
export interface LoginResponse {
  token: string;
  user: AuthUser;
  /** Every scope this user may act in, for the scope switcher on first load. */
  memberships: MembershipSummary[];
}

/** Response body from POST /api/auth/register. */
export interface RegisterResponse extends AuthUser {
  createdAt: string;
  modifiedAt: string;
}

// ── Tenancy ───────────────────────────────────────────────────────────────────

export interface OrganizationSummary {
  _id: string;
  name: string;
  slug: string;
  status: TenantStatus;
}

export interface PropertySummary {
  _id: string;
  orgId: string;
  name: string;
  slug: string;
  status: TenantStatus;
}

export interface LocationSummary {
  _id: string;
  orgId: string;
  propertyId: string;
  name: string;
  slug: string;
  timezone: string;
  status: TenantStatus;
}

/**
 * One row of "where this user may act". The web scope switcher renders these
 * and sends the chosen ids back as the X-Org-Id / X-Property-Id / X-Location-Id
 * headers on every subsequent request.
 */
export interface MembershipSummary {
  _id: string;
  role: TenantRole;
  status: MembershipStatus;
  tier: TenantTier;
  org: OrganizationSummary;
  property: PropertySummary | null;
  location: LocationSummary | null;
}

/** The full tree a user can see, for the org/property/location picker. */
export interface TenantTree {
  org: OrganizationSummary;
  properties: (PropertySummary & { locations: LocationSummary[] })[];
}

// ── Platform console (superAdmin only) ────────────────────────────────────────

/** Headline counts for the platform dashboard. */
export interface PlatformStats {
  users: number;
  organizations: number;
  properties: number;
  locations: number;
  activeMemberships: number;
}

/** One row of the cross-tenant organization list. */
export interface PlatformOrganizationRow extends OrganizationSummary {
  locales: Locale[];
  createdAt: string;
  counts: { properties: number; locations: number; members: number };
}

/** One member row inside the platform org-detail view. */
export interface PlatformOrgMember {
  membershipId: string;
  role: TenantRole;
  status: MembershipStatus;
  tier: TenantTier;
  propertyId: string | null;
  locationId: string | null;
  user: { _id: string; name: UserName; email: string };
}

/** Everything the platform console shows about one organization. */
export interface PlatformOrganizationDetail {
  org: PlatformOrganizationRow;
  properties: PropertySummary[];
  locations: LocationSummary[];
  members: PlatformOrgMember[];
}

/** One row of the cross-tenant user list. */
export interface PlatformUserRow extends AuthUser {
  membershipCount: number;
  lastLoginAt: string | null;
  createdAt: string;
}
