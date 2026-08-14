import type {
  ApiResult,
  RecipeTranslationState,
  RecipeTranslationView,
  TargetLocale,
  TrainingTranslationState,
  TrainingTranslationView,
} from '@rit/shared';
import { apiRequest } from './client';

/**
 * Recipe and training translations, reader slice only. The GETs are role-aware
 * server-side: staff only ever receive an approved, current translation;
 * reviewers get the full document plus its stale flag. The POSTs spend money —
 * they sit behind the API's LLM rate limiter and answer 503 when no key is
 * configured.
 */

export function getRecipeTranslation(
  recipeId: string,
  locale: TargetLocale = 'es',
): Promise<ApiResult<RecipeTranslationState>> {
  return apiRequest<RecipeTranslationState>(
    `/api/translations/recipes/${recipeId}?locale=${locale}`,
  );
}

export function machineTranslateRecipe(
  recipeId: string,
  locale: TargetLocale = 'es',
): Promise<ApiResult<RecipeTranslationView>> {
  return apiRequest<RecipeTranslationView>(`/api/translations/recipes/${recipeId}`, {
    method: 'POST',
    body: JSON.stringify({ locale }),
  });
}

export function getTrainingTranslation(
  trainingId: string,
  locale: TargetLocale = 'es',
): Promise<ApiResult<TrainingTranslationState>> {
  return apiRequest<TrainingTranslationState>(
    `/api/translations/trainings/${trainingId}?locale=${locale}`,
  );
}

export function machineTranslateTraining(
  trainingId: string,
  locale: TargetLocale = 'es',
): Promise<ApiResult<TrainingTranslationView>> {
  return apiRequest<TrainingTranslationView>(`/api/translations/trainings/${trainingId}`, {
    method: 'POST',
    body: JSON.stringify({ locale }),
  });
}
