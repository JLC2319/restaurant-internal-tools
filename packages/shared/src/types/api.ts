import type {
  Allergen,
  ApprovalStatus,
  ContentOrigin,
  Dietary,
  IngredientKind,
  Locale,
  MediaKind,
  MediaStatus,
  MembershipStatus,
  PlatformRole,
  RecipePublishMode,
  RecipeStatus,
  TenantRole,
  TenantScope,
  TenantSettings,
  TenantSettingsOverride,
  TenantStatus,
  TenantTier,
  TrainingStatus,
  TranslationPublishMode,
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
  phone: string | null;
  jobTitle: string | null;
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
  /** Overrides of the org's settings. `null` fields inherit from the org. */
  settings: TenantSettingsOverride;
}

export interface LocationSummary {
  _id: string;
  orgId: string;
  propertyId: string;
  name: string;
  slug: string;
  timezone: string;
  status: TenantStatus;
  /** Overrides of the property's (then org's) settings. `null` fields inherit. */
  settings: TenantSettingsOverride;
}

/** A postal address as rendered to clients. Absent parts come back `null`. */
export interface AddressView {
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
}

/**
 * The full org profile, returned by GET/PATCH /api/tenancy/organization.
 * A superset of `OrganizationSummary` so existing callers keep working.
 */
export interface OrganizationProfile extends OrganizationSummary {
  locales: Locale[];
  /** Org-wide defaults. Properties and locations may override each of these. */
  settings: TenantSettings;
  logo: MediaAssetView | null;
  address: AddressView | null;
  contact: { phone: string | null; email: string | null; website: string | null };
  createdAt: string;
}

/** One row of the org member roster (GET /api/tenancy/members). */
export interface OrgMemberRow {
  /** Membership id — the id to PATCH/DELETE. */
  _id: string;
  role: TenantRole;
  status: MembershipStatus;
  tier: TenantTier;
  propertyId: string | null;
  locationId: string | null;
  joinedAt: string | null;
  /** Null when the account has since been deleted. */
  user: {
    _id: string;
    name: UserName;
    email: string;
    jobTitle: string | null;
    status: UserStatus;
  } | null;
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

/** One person on an allow-list, resolved for display. */
export interface AccessUserView {
  _id: string;
  name: UserName;
  email: string;
}

/**
 * A person-level allow-list (recipes, trainings). `userIds` is the full stored
 * list; `users` resolves only the ids that still map to an account, so the UI
 * can badge the remainder as former members without a save round-trip ever
 * silently dropping them.
 */
export interface AccessListView {
  userIds: string[];
  users: AccessUserView[];
}

/** One eligible person for the access picker — their membership can see the document's scope. */
export interface AccessCandidate {
  _id: string;
  name: UserName;
  email: string;
  jobTitle: string | null;
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
   * True when the recipe carries a person-level allow-list. Anyone who can see
   * the recipe may see this flag; it names nobody.
   */
  restricted: boolean;
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
  /**
   * Origin lineage — null when this is not a fork, and also null when the
   * caller cannot read the source (its identity is hidden like any other
   * unreadable recipe; `isFork` alone says a lineage has an origin).
   */
  forkedFrom: ForkedFromRef | null;
  createdBy: string;
  currentVersion: number;
  activeVersionId: string | null;
  activeContent: RecipeContentView | null;
  workingCopy: RecipeContentView | null;
  /** Whether the caller may edit/version/fork this recipe (role + write tier). */
  canManage: boolean;
  /**
   * The allow-list, present only when the recipe is restricted AND the caller
   * may manage it. Everyone else — including listed viewers — gets null: who
   * else is trusted is itself managed information.
   */
  access: AccessListView | null;
  /**
   * `recipePublishMode` resolved for *this recipe's* scope, so the editor offers
   * the publish-on-save shortcut on exactly the recipes the server would accept
   * it for. Server-resolved rather than worked out from the caller's active
   * scope — the two can differ, and only one of them governs the document.
   */
  publishMode: RecipePublishMode;
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

// ── Recipe translations ───────────────────────────────────────────────────────

/**
 * The translated *text* of a recipe. Arrays align by index with the source
 * version's ingredients/steps; numbers, units, photos and tags always render
 * from the source, so the translation can never contradict the recipe about
 * what is in the dish. `ingredients[i].name` is null for sub-recipe lines.
 */
export interface TranslationPayloadView {
  name: string;
  description: string;
  ingredients: { name: string | null; note: string | null }[];
  steps: string[];
}

/** One recipe's translation into one locale, with its review state. */
export interface RecipeTranslationView {
  _id: string;
  recipeId: string;
  locale: Locale;
  /** SAFETY: only `approved` (and not stale) may be shown to kitchen staff. */
  status: ApprovalStatus;
  /** `machine` until a reviewer edits it; drives the "AI-assisted" badge. */
  origin: ContentOrigin;
  /** The live version number this translation was made from. */
  sourceVersion: number;
  /**
   * True when the live version or recipe name has changed since this
   * translation was produced. A stale translation never reaches the reader,
   * whatever its status says.
   */
  stale: boolean;
  payload: TranslationPayloadView;
  /** The LLM that produced the current machine text; null after human rewrite from scratch. */
  model: string | null;
  requestedBy: string;
  requestedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  /**
   * SAFETY: true when this translation reached `approved` by the scope's
   * `auto_publish` setting rather than a person reading it. `approvedBy` is
   * null in that case — nobody signed off — and every surface that renders the
   * translation must say so. Any human action (edit, approve, reject) clears it.
   */
  autoApproved: boolean;
  modifiedAt: string;
}

/**
 * Role-aware translation state for one recipe+locale. Staff get `translation`
 * only when it is approved and current — the review gate, encoded in the
 * response shape. Reviewers get the full document plus `stale`.
 */
export interface RecipeTranslationState {
  /** Machine translation is configured server-side (key present + enabled). */
  enabled: boolean;
  /** Whether the caller may trigger, edit and approve translations here. */
  canManage: boolean;
  /**
   * The mode resolved for *this recipe's* scope (location → property → org),
   * so the UI can tell a chef what setting a version live will do here.
   */
  publishMode: TranslationPublishMode;
  /**
   * An automatic translation is running for this recipe *right now* — kicked
   * off by the version going live, and not finished yet.
   *
   * The UI polls on this rather than offering "Translate to Spanish": the
   * button would queue a second run of work already in flight, and a chef who
   * publishes and immediately opens the recipe would otherwise be told nothing
   * is happening. Per recipe rather than per locale, because one run covers
   * every target locale in turn.
   */
  autoTranslating: boolean;
  /**
   * The last automatic run did not produce anything — it errored, or its
   * process died and the marker aged out. Distinguishes "nobody has translated
   * this" from "we tried and it did not work", which want different words.
   */
  autoTranslationFailed: boolean;
  translation: RecipeTranslationView | null;
}

/**
 * The publish mode governing a recipe the caller creates *now*, resolved for
 * their own write scope. For the screens that offer the publish-on-save
 * shortcut before there is a recipe to read it from.
 */
export interface RecipePublishModeView {
  mode: RecipePublishMode;
}

// ── Training translations ─────────────────────────────────────────────────────

/**
 * The translated *text* of a training module. `blocks` aligns by index with
 * the module's blocks: `text` for text blocks (rendered as plain paragraphs —
 * formatting starts fresh in translation), `caption` for media/embed blocks
 * that carry one, null everywhere else. Media assets and embeds always render
 * from the source module.
 */
export interface TrainingTranslationPayloadView {
  title: string;
  description: string;
  blocks: { text: string | null; caption: string | null }[];
}

/** One training module's translation into one locale, with its review state. */
export interface TrainingTranslationView {
  _id: string;
  trainingId: string;
  locale: Locale;
  /** SAFETY: only `approved` (and not stale) may be shown to staff. */
  status: ApprovalStatus;
  /** `machine` until a reviewer edits it; drives the "AI-assisted" badge. */
  origin: ContentOrigin;
  /**
   * True when the module's text has changed since this translation was
   * produced. Trainings have no version history, so this is purely the
   * content-hash check. A stale translation never reaches the reader.
   */
  stale: boolean;
  payload: TrainingTranslationPayloadView;
  /** The LLM that produced the current machine text. */
  model: string | null;
  requestedBy: string;
  requestedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  /** SAFETY: `approved` reached via `auto_publish`, with no human signature. */
  autoApproved: boolean;
  modifiedAt: string;
}

/**
 * Role-aware translation state for one training+locale — the same contract as
 * `RecipeTranslationState`: staff get `translation` only when it is approved
 * and current, reviewers get the full document plus `stale`.
 */
export interface TrainingTranslationState {
  enabled: boolean;
  canManage: boolean;
  publishMode: TranslationPublishMode;
  /** An automatic translation is running for this module right now. */
  autoTranslating: boolean;
  /** The last automatic run errored or its process died. */
  autoTranslationFailed: boolean;
  translation: TrainingTranslationView | null;
}

// ── AI recipe drafting ────────────────────────────────────────────────────────

/**
 * One recipe extracted from submitted photos. Nothing here is persisted — the
 * caller reviews a proposal and explicitly creates a recipe from it (which
 * lands as an ordinary unpublished draft). Allergen/dietary tags are
 * transcribed only when the source states them, never inferred, and enter the
 * normal pending-review pipeline on create.
 */
export interface RecipeDraftProposal {
  name: string;
  description: string;
  yield: QuantityValue;
  ingredients: { name: string; quantity: QuantityValue; note: string | null }[];
  steps: string[];
  allergens: Allergen[];
  dietary: Dietary[];
  times: { prepMinutes: number | null; cookMinutes: number | null } | null;
  /** What the model could not read or had to adapt — shown to the reviewer. */
  notes: string | null;
}

/** Response of POST /api/drafts/recipes. */
export interface DraftRecipesResponse {
  proposals: RecipeDraftProposal[];
  /** Batch-level commentary (an unreadable page, a photo that isn't a recipe). */
  notes: string | null;
  /** Which model produced the proposals, for the audit trail. */
  model: string;
}

/** Response of GET /api/drafts/config. */
export interface DraftConfigView {
  enabled: boolean;
}

/**
 * One training module drafted from a text description, photos and/or PDFs.
 * Nothing here is persisted — the caller reviews a proposal and explicitly
 * creates a module from it (which lands as an ordinary unpublished draft).
 * `sections` are plain text, one per content block; the create flow turns
 * each into a rich-text block. Submitted files are reference material for the
 * one model call only — they are never stored, so a proposal carries no media
 * blocks.
 */
export interface TrainingDraftProposal {
  title: string;
  description: string;
  sections: string[];
  /** What the model could not read or had to adapt — shown to the reviewer. */
  notes: string | null;
}

/** Response of POST /api/drafts/trainings. */
export interface DraftTrainingsResponse {
  proposals: TrainingDraftProposal[];
  /** Batch-level commentary (an unreadable page, a file that isn't training material). */
  notes: string | null;
  /** Which model produced the proposals, for the audit trail. */
  model: string;
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
  /**
   * True when the module carries a person-level allow-list. Anyone who can see
   * the module may see this flag; it names nobody.
   */
  restricted: boolean;
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
  /**
   * The allow-list, present only when the module is restricted AND the caller
   * may manage it — same disclosure rule as recipes.
   */
  access: AccessListView | null;
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
