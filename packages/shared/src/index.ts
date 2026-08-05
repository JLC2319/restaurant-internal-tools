// Shared types, schemas, and constants used by both @rit/api and @rit/web.
//
// Both apps import from '@rit/shared' — never reach into packages/shared/src
// directly, and never redeclare one of these enums locally.

// ── Schemas ───────────────────────────────────────────────────────────────────

export { objectIdSchema, paginationSchema, slugSchema, toSlug } from './schemas/common.js';
export type { PaginationInput } from './schemas/common.js';

export {
  registerSchema,
  loginSchema,
  updateMeSchema,
  changePasswordSchema,
} from './schemas/auth.js';
export type {
  RegisterInput,
  LoginInput,
  UpdateMeInput,
  ChangePasswordInput,
} from './schemas/auth.js';

export {
  createOrganizationSchema,
  updateOrganizationSchema,
  createPropertySchema,
  updatePropertySchema,
  createLocationSchema,
  updateLocationSchema,
  addressSchema,
  inviteMemberSchema,
  updateMembershipSchema,
} from './schemas/tenancy.js';
export type {
  CreateOrganizationInput,
  UpdateOrganizationInput,
  CreatePropertyInput,
  UpdatePropertyInput,
  CreateLocationInput,
  UpdateLocationInput,
  AddressInput,
  InviteMemberInput,
  UpdateMembershipInput,
} from './schemas/tenancy.js';

export {
  platformListQuerySchema,
  platformCreateOrganizationSchema,
  platformUpdateOrganizationSchema,
  platformUpdateUserSchema,
} from './schemas/platform.js';
export type {
  PlatformListQuery,
  PlatformCreateOrganizationInput,
  PlatformUpdateOrganizationInput,
  PlatformUpdateUserInput,
} from './schemas/platform.js';

// ── Domain constants & types ──────────────────────────────────────────────────

export {
  tenantTierValues,
  tenantRoleValues,
  roleRank,
  roleAtLeast,
  membershipStatusValues,
  tenantStatusValues,
  platformRoleValues,
  userStatusValues,
  localeValues,
  SOURCE_LOCALE,
  approvalStatusValues,
  PUBLISHABLE_STATUS,
  contentOriginValues,
  allergenValues,
  dietaryValues,
  unitFamilyValues,
  unitValues,
  unitFamily,
} from './types/domain.js';
export type {
  TenantTier,
  TenantRole,
  MembershipStatus,
  TenantStatus,
  TenantScope,
  TenantContext,
  PlatformRole,
  UserStatus,
  UserName,
  Locale,
  ApprovalStatus,
  ContentOrigin,
  Allergen,
  Dietary,
  UnitFamily,
  Unit,
} from './types/domain.js';

// ── API contract types ────────────────────────────────────────────────────────

export type {
  ApiResponse,
  PaginatedResponse,
  ValidationError,
  ApiError,
  ApiResult,
  AuthUser,
  LoginResponse,
  RegisterResponse,
  OrganizationSummary,
  PropertySummary,
  LocationSummary,
  MembershipSummary,
  TenantTree,
  PlatformStats,
  PlatformOrganizationRow,
  PlatformOrgMember,
  PlatformOrganizationDetail,
  PlatformUserRow,
} from './types/api.js';
