import type {
  Allergen,
  ApprovalStatus,
  Dietary,
  IngredientKind,
  Locale,
  MediaKind,
  MediaStatus,
  MembershipStatus,
  PlatformRole,
  RecipeStatus,
  TenantRole,
  TenantScope,
  TenantStatus,
  TenantTier,
  TrainingStatus,
  Unit,
  UserName,
  UserStatus,
  VideoEmbedProvider,
} from './domain.js';
import type { RichTextDoc } from '../schemas/richtext.js';

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

// ── Media ─────────────────────────────────────────────────────────────────────

/**
 * One stored asset as returned to clients. `url` is a ready-to-render absolute
 * URL on the media CDN — clients never construct one from the storage key.
 *
 * `width`/`height` come from the file's own header at upload time, so the UI
 * can reserve the right box before the image loads. They are null only for an
 * asset whose dimensions could not be read (video awaiting transcode).
 */
export interface MediaAssetView {
  _id: string;
  kind: MediaKind;
  status: MediaStatus;
  url: string;
  mime: string;
  /** Bytes. */
  size: number;
  width: number | null;
  height: number | null;
  createdAt: string;
}

// ── Recipes ───────────────────────────────────────────────────────────────────

/** A measured amount as it appears in responses. */
export interface QuantityValue {
  amount: number;
  unit: Unit;
}

/**
 * One ingredient line as rendered to clients. `recipe`-kind lines carry the
 * referenced lineage id plus a resolved display `name` so the reader never has
 * to fetch sub-recipes just to print the list.
 */
export interface IngredientLineView {
  kind: IngredientKind;
  name: string;
  recipeId: string | null;
  quantity: QuantityValue;
  note: string | null;
}

/**
 * An allergen tag with its sign-off state. SAFETY: absence of a tag is not a
 * claim of safety — check `allergensVerified` before presenting a recipe as
 * reviewed.
 */
export interface AllergenTagView {
  allergen: Allergen;
  status: ApprovalStatus;
  approvedBy: string | null;
  approvedAt: string | null;
}

/** A recipe body — working copy or version snapshot — as returned to clients. */
export interface RecipeContentView {
  description: string;
  yield: QuantityValue;
  ingredients: IngredientLineView[];
  steps: string[];
  allergens: AllergenTagView[];
  dietary: Dietary[];
  /**
   * Plating photos, in the chef's chosen order — index 0 is the hero shot.
   * Resolved from the stored ids, so an asset deleted out from under the
   * recipe simply drops out of the list rather than rendering broken.
   */
  photos: MediaAssetView[];
  times: { prepMinutes: number | null; cookMinutes: number | null } | null;
}

/** Where a forked lineage came from. */
export interface ForkedFromRef {
  recipeId: string;
  versionId: string;
  version: number;
}

/** One row of the recipe list. */
export interface RecipeSummary {
  _id: string;
  name: string;
  status: RecipeStatus;
  scope: TenantScope;
  /** Version number staff currently cook from; null = unpublished. */
  activeVersion: number | null;
  /** True only when tags exist and every one is approved. */
  allergensVerified: boolean;
  isFork: boolean;
  /**
   * First plating photo of whichever content the caller may see — the live
   * version for staff, the working copy for chefs. Null when there is none.
   */
  heroPhoto: MediaAssetView | null;
  createdAt: string;
  modifiedAt: string;
}

/** Full recipe detail. Staff receive `workingCopy: null` — the active version is their whole truth. */
export interface RecipeDetail extends RecipeSummary {
  forkedFrom: ForkedFromRef | null;
  createdBy: string;
  currentVersion: number;
  activeVersionId: string | null;
  activeContent: RecipeContentView | null;
  workingCopy: RecipeContentView | null;
  /** Whether the caller may edit/version/fork this recipe (role + write tier). */
  canManage: boolean;
}

/** One row of a recipe's version history. */
export interface RecipeVersionSummary {
  _id: string;
  recipeId: string;
  version: number;
  name: string;
  note: string | null;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
}

export interface RecipeVersionDetail extends RecipeVersionSummary {
  content: RecipeContentView;
}

// ── Training ──────────────────────────────────────────────────────────────────

/**
 * One content block as rendered to clients. Text blocks carry the validated
 * rich-text document (see `richTextDocSchema`). Media blocks carry the
 * resolved asset (`media._id` is the id to send back when editing); an asset
 * deleted out from under a module resolves to `null`, and viewers skip the
 * block rather than rendering a broken player. `embed` blocks carry the
 * stored URL plus the server-derived provider and iframe src — clients never
 * build an embed src from the raw URL themselves.
 */
export type TrainingBlockView =
  | { kind: 'text'; doc: RichTextDoc }
  | { kind: 'image'; media: MediaAssetView | null; caption: string | null }
  | { kind: 'video'; media: MediaAssetView | null; caption: string | null }
  | {
      kind: 'embed';
      url: string;
      provider: VideoEmbedProvider;
      embedSrc: string;
      caption: string | null;
    };

/** One row of the training list. */
export interface TrainingSummary {
  _id: string;
  title: string;
  description: string;
  status: TrainingStatus;
  scope: TenantScope;
  /** First image block that still resolves — the card art. Null when none. */
  heroImage: MediaAssetView | null;
  blockCount: number;
  /** Uploaded videos plus external embeds — drives the "video" chip. */
  videoCount: number;
  /** When the caller completed this module (any location), ISO — null if never. */
  myCompletion: string | null;
  publishedAt: string | null;
  createdAt: string;
  modifiedAt: string;
}

export interface TrainingDetail extends TrainingSummary {
  blocks: TrainingBlockView[];
  createdBy: string;
  /** Whether the caller may edit/publish/archive this module (role + write tier). */
  canManage: boolean;
  /** Completions across the caller's scope. Null for callers below chef. */
  completedCount: number | null;
}

/** The caller's completion state, returned by the complete/uncomplete calls. */
export interface TrainingCompletionState {
  completed: boolean;
  completedAt: string | null;
}

/** One row of a module's completion roster (chef+ only). */
export interface TrainingCompletionRow {
  userId: string;
  /** Null when the account has since been deleted. */
  name: UserName | null;
  email: string | null;
  locationId: string | null;
  completedAt: string;
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
