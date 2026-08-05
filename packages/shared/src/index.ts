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
  orgContactSchema,
  tenantSettingsSchema,
  tenantSettingsOverrideSchema,
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
  OrgContactInput,
  TenantSettingsInput,
  TenantSettingsOverrideInput,
  InviteMemberInput,
  UpdateMembershipInput,
} from './schemas/tenancy.js';

export {
  quantitySchema,
  ingredientLineSchema,
  recipeContentSchema,
  createRecipeSchema,
  updateRecipeSchema,
  saveVersionSchema,
  forkRecipeSchema,
  approveAllergensSchema,
  listRecipesQuerySchema,
} from './schemas/recipes.js';
export type {
  QuantityInput,
  IngredientLineInput,
  RecipeContentInput,
  CreateRecipeInput,
  UpdateRecipeInput,
  SaveVersionInput,
  ForkRecipeInput,
  ApproveAllergensInput,
  ListRecipesQuery,
} from './schemas/recipes.js';

export {
  translatedIngredientSchema,
  translationPayloadSchema,
  translationLocaleSchema,
  updateTranslationSchema,
} from './schemas/translations.js';
export type {
  TranslatedIngredientInput,
  TranslationPayloadInput,
  TranslationLocaleInput,
  UpdateTranslationInput,
} from './schemas/translations.js';

export { draftRecipesSchema } from './schemas/drafting.js';
export type { DraftRecipesInput } from './schemas/drafting.js';

export {
  richTextDocSchema,
  emptyRichTextDoc,
  docToPlainText,
  plainTextToDoc,
} from './schemas/richtext.js';
export type {
  RichTextDoc,
  RichTextBlockNode,
  RichTextInlineNode,
  RichTextTextNode,
  RichTextMark,
} from './schemas/richtext.js';

export {
  parseVideoEmbed,
  trainingBlockSchema,
  createTrainingSchema,
  updateTrainingSchema,
  listTrainingsQuerySchema,
} from './schemas/training.js';
export type {
  VideoEmbed,
  TrainingBlockInput,
  CreateTrainingInput,
  UpdateTrainingInput,
  ListTrainingsQuery,
} from './schemas/training.js';

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
  targetLocaleValues,
  translationPublishModeValues,
  DEFAULT_TRANSLATION_PUBLISH_MODE,
  resolveTranslationPublishMode,
  approvalStatusValues,
  PUBLISHABLE_STATUS,
  contentOriginValues,
  allergenValues,
  dietaryValues,
  recipeStatusValues,
  ingredientKindValues,
  mediaKindValues,
  mediaStatusValues,
  imageMimeValues,
  videoMimeValues,
  MAX_RECIPE_PHOTOS,
  MAX_PHOTO_BYTES,
  MAX_DRAFT_PHOTOS,
  MAX_DRAFT_TOTAL_BYTES,
  MAX_VIDEO_BYTES,
  trainingStatusValues,
  trainingBlockKindValues,
  videoEmbedProviderValues,
  MAX_TRAINING_BLOCKS,
  MAX_TRAINING_TEXT_CHARS,
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
  TenantSettings,
  TenantSettingsOverride,
  TranslationPublishMode,
  PlatformRole,
  UserStatus,
  UserName,
  Locale,
  TargetLocale,
  ApprovalStatus,
  ContentOrigin,
  Allergen,
  Dietary,
  RecipeStatus,
  IngredientKind,
  MediaKind,
  MediaStatus,
  ImageMime,
  VideoMime,
  TrainingStatus,
  TrainingBlockKind,
  VideoEmbedProvider,
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
  OrganizationProfile,
  AddressView,
  OrgMemberRow,
  PropertySummary,
  LocationSummary,
  MembershipSummary,
  TenantTree,
  PlatformStats,
  PlatformOrganizationRow,
  PlatformOrgMember,
  PlatformOrganizationDetail,
  PlatformUserRow,
  MediaAssetView,
  QuantityValue,
  IngredientLineView,
  AllergenTagView,
  RecipeContentView,
  ForkedFromRef,
  RecipeSummary,
  RecipeDetail,
  RecipeVersionSummary,
  RecipeVersionDetail,
  TranslationPayloadView,
  RecipeTranslationView,
  RecipeTranslationState,
  RecipeDraftProposal,
  DraftRecipesResponse,
  DraftConfigView,
  TrainingBlockView,
  TrainingSummary,
  TrainingDetail,
  TrainingCompletionState,
  TrainingCompletionRow,
} from './types/api.js';
