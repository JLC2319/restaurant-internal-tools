import type { ApiResult, PaginatedResponse, RecipeDetail, RecipeStatus, RecipeSummary } from '@rit/shared'
import { apiRequest, getScope } from './client'

/**
 * Query-key prefix segment for the active scope. Every recipe query key
 * includes it so a scope switch can never serve one tenant's recipes under
 * another's header (the switcher also clears the query cache — belt and
 * braces, same rule as the web app).
 */
export function recipesScopeKey(): (string | null)[] {
  const scope = getScope()
  return [scope?.orgId ?? null, scope?.propertyId ?? null, scope?.locationId ?? null]
}

export interface ListRecipesParams {
  q?: string
  page?: number
  limit?: number
  status?: RecipeStatus
  /** Only lineages with a live version — the reader's shelf. */
  live?: boolean
}

export function listRecipes(
  params: ListRecipesParams = {}
): Promise<ApiResult<PaginatedResponse<RecipeSummary>>> {
  const query = new URLSearchParams()
  if (params.q) query.set('q', params.q)
  if (params.page) query.set('page', String(params.page))
  if (params.limit) query.set('limit', String(params.limit))
  if (params.status) query.set('status', params.status)
  if (params.live) query.set('live', 'true')
  const qs = query.toString()
  return apiRequest<PaginatedResponse<RecipeSummary>>(`/api/recipes${qs ? `?${qs}` : ''}`)
}

export function getRecipe(id: string): Promise<ApiResult<RecipeDetail>> {
  return apiRequest<RecipeDetail>(`/api/recipes/${id}`)
}
