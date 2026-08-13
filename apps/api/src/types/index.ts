import type { Document, Types } from 'mongoose';
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
  RecipeStatus,
  RecipePublishMode,
  RichTextDoc,
  TenantContext,
  TenantRole,
  TenantStatus,
  TrainingBlockKind,
  TrainingStatus,
  TranslationPublishMode,
  Unit,
  UserName,
  UserStatus,
  VideoMime,
} from '@rit/shared';

// Re-export the shared domain types so feature modules can import everything
// they need from '../../types/index' without reaching past the shared barrel.
export type {
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
  TenantContext,
  TenantRole,
  TenantStatus,
  TrainingBlockKind,
  TrainingStatus,
  TranslationPublishMode,
  Unit,
  UserName,
  UserStatus,
  VideoMime,
};

/**
 * The scope stamped on every tenant-owned document, in its Mongoose form.
 * See lib/scope.ts — `propertyId` and `locationId` are explicit null, not absent.
 */
export interface IScope {
  orgId: Types.ObjectId;
  propertyId: Types.ObjectId | null;
  locationId: Types.ObjectId | null;
}

export interface IUser extends Document {
  name: UserName;
  email: string;
  passwordHash: string;
  emailVerified: boolean;
  emailVerificationToken?: string;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  platformRole: PlatformRole;
  status: UserStatus;
  preferredLocale: Locale;
  phone?: string | null;
  jobTitle?: string | null;
  lastLoginAt?: Date;
  createdAt: Date;
  modifiedAt: Date;
}

/** Public-facing org contact details. All optional; `null` means "cleared". */
export interface IOrgContact {
  phone?: string | null;
  email?: string | null;
  website?: string | null;
}

/**
 * Org-wide settings. Concrete values — the org is the root of the tree, so
 * there is nothing above it to inherit from.
 */
export interface ITenantSettings {
  translationPublishMode: TranslationPublishMode;
  recipePublishMode: RecipePublishMode;
}

/**
 * The same settings at a property or location, where `null` means "inherit
 * from the parent". Stored explicitly rather than omitted so a cleared
 * override is distinguishable from a document written before the field existed.
 */
export interface ITenantSettingsOverride {
  translationPublishMode: TranslationPublishMode | null;
  recipePublishMode: RecipePublishMode | null;
}

export interface IOrganization extends Document {
  name: string;
  slug: string;
  status: TenantStatus;
  /** Locales this org publishes in. `en` is the authoring locale and always present. */
  locales: Locale[];
  settings: ITenantSettings;
  /** An org-owned photo Media asset; the binary lives in R2 like any other. */
  logoMediaId: Types.ObjectId | null;
  address?: IAddress | null;
  contact?: IOrgContact | null;
  createdAt: Date;
  modifiedAt: Date;
}

export interface IProperty extends Document {
  orgId: Types.ObjectId;
  name: string;
  slug: string;
  status: TenantStatus;
  settings: ITenantSettingsOverride;
  createdAt: Date;
  modifiedAt: Date;
}

export interface IAddress {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}

export interface ILocation extends Document {
  orgId: Types.ObjectId;
  propertyId: Types.ObjectId;
  name: string;
  slug: string;
  /** IANA zone. Line checks and prep lists are day-bounded, so this is load-bearing. */
  timezone: string;
  address?: IAddress;
  status: TenantStatus;
  settings: ITenantSettingsOverride;
  createdAt: Date;
  modifiedAt: Date;
}

export interface IMembership extends Document {
  userId: Types.ObjectId;
  orgId: Types.ObjectId;
  /** Null for an org-wide membership. */
  propertyId: Types.ObjectId | null;
  /** Null unless the membership is pinned to a single location. */
  locationId: Types.ObjectId | null;
  role: TenantRole;
  status: MembershipStatus;
  invitedBy?: Types.ObjectId;
  joinedAt?: Date;
  createdAt: Date;
  modifiedAt: Date;
}

/**
 * A stored asset — a plating photo today, training video later. The binary
 * lives in object storage; this record is the tenant-scoped index of it.
 *
 * `key` is the storage path, never exposed to clients: they get the assembled
 * CDN `url` instead, so the bucket layout stays ours to change.
 */
export interface IMedia extends Document {
  scope: IScope;
  kind: MediaKind;
  status: MediaStatus;
  /** Tenant-prefixed object key. Its extension comes from the sniffed bytes. */
  key: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  uploadedBy: Types.ObjectId;
  createdAt: Date;
  modifiedAt: Date;
}

export interface IQuantity {
  amount: number;
  unit: Unit;
}

/**
 * One ingredient line. `kind: 'item'` carries `name`; `kind: 'recipe'` carries
 * `recipeId` (a Recipe lineage id — consumers follow its active version). Zod
 * enforces the discrimination at the boundary; Mongoose stores one loose shape.
 */
export interface IIngredientLine {
  kind: IngredientKind;
  name?: string;
  recipeId?: Types.ObjectId | null;
  quantity: IQuantity;
  note?: string;
}

/**
 * An allergen tag and its sign-off. SAFETY: tags only reach staff at
 * `approved`, and stamps are server-written — see mergeAllergenTags in
 * recipe.service.ts.
 */
export interface IAllergenTag {
  allergen: Allergen;
  status: ApprovalStatus;
  approvedBy: Types.ObjectId | null;
  approvedAt: Date | null;
}

/** The editable recipe body — the working copy, and what versions snapshot. */
export interface IRecipeContent {
  description: string;
  yield: IQuantity;
  ingredients: IIngredientLine[];
  steps: string[];
  allergens: IAllergenTag[];
  dietary: Dietary[];
  /** References into the future media feature; recipes never store binaries. */
  photoIds: Types.ObjectId[];
  times?: { prepMinutes?: number; cookMinutes?: number };
}

export interface IForkedFrom {
  recipeId: Types.ObjectId;
  versionId: Types.ObjectId;
  version: number;
}

/**
 * A recipe lineage head: identity + the mutable working copy + the pointer to
 * the active (staff-visible) version. Immutable history lives in RecipeVersion.
 */
export interface IRecipe extends Document {
  scope: IScope;
  name: string;
  status: RecipeStatus;
  workingCopy: IRecipeContent;
  /** Highest version number ever minted for this lineage; $inc target. */
  currentVersion: number;
  activeVersionId: Types.ObjectId | null;
  /** Denormalised from the active version doc for list display. */
  activeVersion: number | null;
  forkedFrom: IForkedFrom | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  modifiedAt: Date;
}

/** An immutable snapshot of a recipe's working copy at save time. */
export interface IRecipeVersion extends Document {
  recipeId: Types.ObjectId;
  version: number;
  /** Head name stamped at snapshot time, so old versions keep their historical title. */
  name: string;
  content: IRecipeContent;
  note?: string;
  /** Denormalised from the head — safe because a lineage's scope never mutates. */
  scope: IScope;
  createdBy: Types.ObjectId;
  createdAt: Date;
  modifiedAt: Date;
}

/**
 * The translated text of one recipe, aligned by index with the source
 * version's arrays. `ingredients[i].name` is null for sub-recipe lines —
 * those names belong to the referenced lineage.
 */
export interface ITranslationPayload {
  name: string;
  description: string;
  ingredients: { name: string | null; note: string | null }[];
  steps: string[];
}

/**
 * One recipe's translation into one locale — the machine output plus its
 * review state. SAFETY: only `approved` and non-stale translations reach the
 * reader; see translation.service.ts for how staleness is derived from
 * `sourceVersionId` + `sourceHash`.
 */
export interface IRecipeTranslation extends Document {
  scope: IScope;
  recipeId: Types.ObjectId;
  locale: Locale;
  status: ApprovalStatus;
  origin: ContentOrigin;
  /** The live snapshot this translation was made from. */
  sourceVersionId: Types.ObjectId;
  sourceVersion: number;
  /** Hash of the translatable projection (name + text), for cheap staleness checks. */
  sourceHash: string;
  payload: ITranslationPayload;
  /** LLM model id that produced the machine text. Named to dodge Document#model(). */
  llmModel: string | null;
  requestedBy: Types.ObjectId;
  requestedAt: Date;
  approvedBy: Types.ObjectId | null;
  approvedAt: Date | null;
  /**
   * SAFETY: `approved` was reached by the scope's `auto_publish` setting, not
   * by a person. `approvedBy` stays null — there is no signature to record —
   * and the reader badges the text as unreviewed. Cleared by any human action.
   */
  autoApproved: boolean;
  createdAt: Date;
  modifiedAt: Date;
}

/**
 * One training content block, in its Mongoose form. Like ingredient lines the
 * union is enforced by Zod at the boundary; Mongoose stores one loose shape
 * where only the fields for the block's `kind` are set.
 */
export interface ITrainingBlock {
  kind: TrainingBlockKind;
  /** `text` blocks: the rich-text document, validated by `richTextDocSchema`. */
  doc?: RichTextDoc | null;
  /**
   * Pre-rich-text `text` blocks stored plain text here. Never written any
   * more; read once by the shaper's legacy fallback and preserved as plain
   * paragraphs.
   */
  body?: string;
  /** `image` / `video` blocks: a Media asset reference, never inline bytes. */
  mediaId?: Types.ObjectId | null;
  /** `embed` blocks: the pasted YouTube/Vimeo URL (allow-list validated). */
  url?: string;
  caption?: string;
}

/**
 * A training module: ordered content blocks behind a publish gate. Edited in
 * place — no version history — so `published` is the entire staff-visibility
 * rule, and archiving always passes back through `draft` on the way out.
 */
export interface ITrainingModule extends Document {
  scope: IScope;
  title: string;
  description: string;
  status: TrainingStatus;
  blocks: ITrainingBlock[];
  publishedAt: Date | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  modifiedAt: Date;
}

/**
 * One person finished one module in one location context — the seed of the
 * Phase 2 productivity tracking. Scope ids are flat (not a `scope` subdoc)
 * because a completion is not scoped *content*: it records where the person
 * was working when they completed, `null` when they hold an org- or
 * property-wide membership.
 */
export interface ITrainingCompletion extends Document {
  trainingId: Types.ObjectId;
  orgId: Types.ObjectId;
  propertyId: Types.ObjectId | null;
  locationId: Types.ObjectId | null;
  userId: Types.ObjectId;
  completedAt: Date;
  createdAt: Date;
  modifiedAt: Date;
}

// Extend the Express request with what our middleware attaches.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `authenticate` / `optionalAuthenticate` — the JWT `sub` claim. */
      userId?: string;
      /** Set by `resolveTenant` — the caller's position in the hierarchy. */
      tenant?: TenantContext;
      /** Set by `validateQuery` — Express 5 makes `req.query` read-only. */
      validatedQuery?: unknown;
    }

    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Multer {
      /** Set by the R2 streaming storage engine (`media/videoStorage.ts`). */
      interface File {
        /** Object key the video was streamed to. */
        r2Key?: string;
        /** Container decided from the sniffed bytes, never the client header. */
        r2Mime?: VideoMime;
        /** Total bytes streamed. */
        r2Size?: number;
      }
    }
  }
}
