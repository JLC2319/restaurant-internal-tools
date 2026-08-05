import type {
  ApiResult,
  RecipeTranslationState,
  RecipeTranslationView,
  TargetLocale,
  TranslationPayloadInput,
} from '@rit/shared'
import { apiRequest } from './client'

/**
 * Recipe translations. The GET is role-aware server-side: staff only ever
 * receive an approved, current translation; reviewers get the full document
 * plus its stale flag. The POST spends money — it sits behind the API's LLM
 * rate limiter and answers 503 when no key is configured.
 */

export function getRecipeTranslation(
  recipeId: string,
  locale: TargetLocale = 'es'
): Promise<ApiResult<RecipeTranslationState>> {
  return apiRequest<RecipeTranslationState>(
    `/api/translations/recipes/${recipeId}?locale=${locale}`
  )
}

export function machineTranslateRecipe(
  recipeId: string,
  locale: TargetLocale = 'es'
): Promise<ApiResult<RecipeTranslationView>> {
  return apiRequest<RecipeTranslationView>(`/api/translations/recipes/${recipeId}`, {
    method: 'POST',
    body: JSON.stringify({ locale }),
  })
}

export function updateRecipeTranslation(
  recipeId: string,
  payload: TranslationPayloadInput,
  locale: TargetLocale = 'es'
): Promise<ApiResult<RecipeTranslationView>> {
  return apiRequest<RecipeTranslationView>(`/api/translations/recipes/${recipeId}`, {
    method: 'PATCH',
    body: JSON.stringify({ locale, payload }),
  })
}

export function approveRecipeTranslation(
  recipeId: string,
  locale: TargetLocale = 'es'
): Promise<ApiResult<RecipeTranslationView>> {
  return apiRequest<RecipeTranslationView>(`/api/translations/recipes/${recipeId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ locale }),
  })
}

export function rejectRecipeTranslation(
  recipeId: string,
  locale: TargetLocale = 'es'
): Promise<ApiResult<RecipeTranslationView>> {
  return apiRequest<RecipeTranslationView>(`/api/translations/recipes/${recipeId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ locale }),
  })
}
