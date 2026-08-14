import type {
  ApiResult,
  RecipeTranslationState,
  RecipeTranslationView,
  TargetLocale,
  TrainingTranslationPayloadInput,
  TrainingTranslationState,
  TrainingTranslationView,
  TranslationPayloadInput,
} from '@rit/shared'
import { apiRequest } from '@/lib/api/client'

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

/**
 * Training-module translations — the same five-call contract, per module. The
 * GET is role-aware in exactly the recipe way; the POST spends money behind
 * the same LLM rate limiter.
 */

export function getTrainingTranslation(
  trainingId: string,
  locale: TargetLocale = 'es'
): Promise<ApiResult<TrainingTranslationState>> {
  return apiRequest<TrainingTranslationState>(
    `/api/translations/trainings/${trainingId}?locale=${locale}`
  )
}

export function machineTranslateTraining(
  trainingId: string,
  locale: TargetLocale = 'es'
): Promise<ApiResult<TrainingTranslationView>> {
  return apiRequest<TrainingTranslationView>(`/api/translations/trainings/${trainingId}`, {
    method: 'POST',
    body: JSON.stringify({ locale }),
  })
}

export function updateTrainingTranslation(
  trainingId: string,
  payload: TrainingTranslationPayloadInput,
  locale: TargetLocale = 'es'
): Promise<ApiResult<TrainingTranslationView>> {
  return apiRequest<TrainingTranslationView>(`/api/translations/trainings/${trainingId}`, {
    method: 'PATCH',
    body: JSON.stringify({ locale, payload }),
  })
}

export function approveTrainingTranslation(
  trainingId: string,
  locale: TargetLocale = 'es'
): Promise<ApiResult<TrainingTranslationView>> {
  return apiRequest<TrainingTranslationView>(
    `/api/translations/trainings/${trainingId}/approve`,
    {
      method: 'POST',
      body: JSON.stringify({ locale }),
    }
  )
}

export function rejectTrainingTranslation(
  trainingId: string,
  locale: TargetLocale = 'es'
): Promise<ApiResult<TrainingTranslationView>> {
  return apiRequest<TrainingTranslationView>(
    `/api/translations/trainings/${trainingId}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ locale }),
    }
  )
}
