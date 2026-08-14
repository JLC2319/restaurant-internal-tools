import type {
  ApiResult,
  DraftConfigView,
  DraftRecipesResponse,
  DraftTrainingsResponse,
} from '@rit/shared'
import { apiRequest } from './client'

/**
 * AI drafting. Files go up as multipart — `apiRequest` detects the FormData
 * body and lets the browser set the boundary. Nothing is persisted
 * server-side: the response is a set of proposals the user reviews and
 * explicitly turns into drafts via the ordinary create calls.
 */

export function getDraftConfig(): Promise<ApiResult<DraftConfigView>> {
  return apiRequest<DraftConfigView>('/api/drafts/config')
}

export function draftRecipesFromPhotos(
  files: File[],
  hint?: string
): Promise<ApiResult<DraftRecipesResponse>> {
  const body = new FormData()
  for (const file of files) body.append('photos', file)
  if (hint) body.append('hint', hint)
  return apiRequest<DraftRecipesResponse>('/api/drafts/recipes', { method: 'POST', body })
}

/** Draft training modules from a description and/or photos and PDFs. */
export function draftTrainingsFromMaterials(
  files: File[],
  description?: string
): Promise<ApiResult<DraftTrainingsResponse>> {
  const body = new FormData()
  for (const file of files) body.append('files', file)
  if (description) body.append('description', description)
  return apiRequest<DraftTrainingsResponse>('/api/drafts/trainings', { method: 'POST', body })
}
