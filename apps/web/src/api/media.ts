import type { ApiResult, MediaAssetView } from '@rit/shared'
import { apiRequest } from './client'

/**
 * Media uploads. The API decides an upload's real format from its bytes, so
 * there is nothing to declare here beyond the file itself — `apiRequest`
 * detects the FormData body and lets the browser set the multipart boundary.
 */

export function uploadPhoto(file: File): Promise<ApiResult<MediaAssetView>> {
  const body = new FormData()
  body.append('file', file)
  return apiRequest<MediaAssetView>('/api/media/photos', { method: 'POST', body })
}

/**
 * Deletes the asset itself, not just its use on a recipe. Removing a photo from
 * a recipe is a recipe edit — this is for discarding an upload outright.
 */
export function deleteAsset(id: string): Promise<ApiResult<null>> {
  return apiRequest<null>(`/api/media/${id}`, { method: 'DELETE' })
}
