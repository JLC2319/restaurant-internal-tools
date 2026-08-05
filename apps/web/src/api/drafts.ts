import type { ApiResult, DraftConfigView, DraftRecipesResponse } from '@rit/shared'
import { apiRequest } from './client'

/**
 * AI recipe drafting. Photos go up as multipart — `apiRequest` detects the
 * FormData body and lets the browser set the boundary. Nothing is persisted
 * server-side: the response is a set of proposals the user reviews and
 * explicitly turns into draft recipes via the ordinary create call.
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
