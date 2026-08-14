import type {
  ApiResult,
  ApproveAllergensInput,
  CreateRecipeInput,
  ForkRecipeInput,
  PaginatedResponse,
  MoveRecipeInput,
  PublishRecipeInput,
  AccessCandidate,
  RecipeDetail,
  RecipePublishModeView,
  RecipeStatus,
  RecipeSummary,
  RecipeVersionDetail,
  RecipeVersionSummary,
  SaveVersionInput,
  UpdateRecipeAccessInput,
  UpdateRecipeInput,
} from '@rit/shared';
import { apiRequest, buildQuery } from '@/lib/api/client';

/**
 * Query-key prefix segment for the active scope. Every recipe query key
 * includes it so a scope switch can never serve one tenant's recipes under
 * another's header (the switcher also hard-reloads — belt and braces).
 */
export { scopeKey as recipesScopeKey } from '@/lib/api/client';

export interface ListRecipesParams {
  q?: string;
  page?: number;
  limit?: number;
  status?: RecipeStatus;
  /** Only lineages with a live version — the reader's shelf. */
  live?: boolean;
}

export function listRecipes(
  params: ListRecipesParams = {},
): Promise<ApiResult<PaginatedResponse<RecipeSummary>>> {
  const qs = buildQuery({
    q: params.q,
    page: params.page,
    limit: params.limit,
    status: params.status,
    live: params.live,
  });
  return apiRequest<PaginatedResponse<RecipeSummary>>(`/api/recipes${qs}`);
}

/**
 * The publish mode a recipe created right now would get. For screens offering
 * the shortcut before a recipe exists — the AI draft review, above all.
 */
export function getScopePublishMode(): Promise<ApiResult<RecipePublishModeView>> {
  return apiRequest<RecipePublishModeView>('/api/recipes/publish-mode');
}

export function getRecipe(id: string): Promise<ApiResult<RecipeDetail>> {
  return apiRequest<RecipeDetail>(`/api/recipes/${id}`);
}

export function createRecipe(input: CreateRecipeInput): Promise<ApiResult<RecipeDetail>> {
  return apiRequest<RecipeDetail>('/api/recipes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateRecipe(
  id: string,
  input: UpdateRecipeInput,
): Promise<ApiResult<RecipeDetail>> {
  return apiRequest<RecipeDetail>(`/api/recipes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function archiveRecipe(id: string): Promise<ApiResult<null>> {
  return apiRequest<null>(`/api/recipes/${id}`, { method: 'DELETE' });
}

export function unarchiveRecipe(id: string): Promise<ApiResult<RecipeDetail>> {
  return apiRequest<RecipeDetail>(`/api/recipes/${id}/unarchive`, { method: 'POST' });
}

export function listVersions(id: string): Promise<ApiResult<RecipeVersionSummary[]>> {
  return apiRequest<RecipeVersionSummary[]>(`/api/recipes/${id}/versions`);
}

export function getVersion(id: string, versionId: string): Promise<ApiResult<RecipeVersionDetail>> {
  return apiRequest<RecipeVersionDetail>(`/api/recipes/${id}/versions/${versionId}`);
}

export function saveVersion(
  id: string,
  input: SaveVersionInput,
): Promise<ApiResult<RecipeVersionSummary>> {
  return apiRequest<RecipeVersionSummary>(`/api/recipes/${id}/versions`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Mint v1 and set it live in one call. Only valid for a recipe that has never
 * been live, and only where `recipePublishMode` allows it — the server checks
 * both, so a stale toggle on screen fails loudly rather than half-publishing.
 */
export function publishRecipe(
  id: string,
  input: PublishRecipeInput,
): Promise<ApiResult<RecipeDetail>> {
  return apiRequest<RecipeDetail>(`/api/recipes/${id}/publish`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function activateVersion(id: string, versionId: string): Promise<ApiResult<RecipeDetail>> {
  return apiRequest<RecipeDetail>(`/api/recipes/${id}/versions/${versionId}/activate`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function deactivateRecipe(id: string): Promise<ApiResult<RecipeDetail>> {
  return apiRequest<RecipeDetail>(`/api/recipes/${id}/deactivate`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function restoreVersion(id: string, versionId: string): Promise<ApiResult<RecipeDetail>> {
  return apiRequest<RecipeDetail>(`/api/recipes/${id}/versions/${versionId}/restore`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function forkRecipe(id: string, input: ForkRecipeInput): Promise<ApiResult<RecipeDetail>> {
  return apiRequest<RecipeDetail>(`/api/recipes/${id}/fork`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Move the recipe to a new home in the tree; the server re-validates everything placement touches. */
export function moveRecipe(id: string, input: MoveRecipeInput): Promise<ApiResult<RecipeDetail>> {
  return apiRequest<RecipeDetail>(`/api/recipes/${id}/scope`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/** Replace the person-level allow-list wholesale; `access: null` clears it. */
export function updateRecipeAccess(
  id: string,
  input: UpdateRecipeAccessInput,
): Promise<ApiResult<RecipeDetail>> {
  return apiRequest<RecipeDetail>(`/api/recipes/${id}/access`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/** Everyone the allow-list may name: members whose scope covers this recipe. */
export function listAccessCandidates(id: string): Promise<ApiResult<AccessCandidate[]>> {
  return apiRequest<AccessCandidate[]>(`/api/recipes/${id}/access/candidates`);
}

export function approveAllergens(
  id: string,
  input: ApproveAllergensInput,
): Promise<ApiResult<RecipeDetail>> {
  return apiRequest<RecipeDetail>(`/api/recipes/${id}/allergens/approve`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
