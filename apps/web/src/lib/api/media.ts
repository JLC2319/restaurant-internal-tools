import type { ApiError, ApiResult, MediaAssetView } from '@rit/shared'
import { BASE_URL, apiRequest, buildAuthScopeHeaders, handleUnauthorized } from '@/lib/api/client'

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
 * Streams a training video up and reports progress as a 0–1 fraction.
 *
 * XHR rather than fetch, deliberately: fetch has no upload-progress events
 * (readable request streams are still gated behind flags/HTTP2), and a
 * multi-hundred-MB upload over kitchen wifi without a progress bar looks
 * frozen. The server streams the body straight to R2, so progress here tracks
 * real storage progress, not a buffer filling.
 */
export function uploadVideo(
  file: File,
  onProgress: (fraction: number) => void
): Promise<ApiResult<MediaAssetView>> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE_URL}/api/media/videos`)

    for (const [name, value] of Object.entries(buildAuthScopeHeaders())) {
      xhr.setRequestHeader(name, value)
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve({ data: JSON.parse(xhr.responseText) as MediaAssetView, error: null })
        } catch {
          resolve({ data: null, error: { message: 'Unexpected server response' } })
        }
        return
      }
      let error: ApiError = { message: `HTTP ${xhr.status}` }
      try {
        error = JSON.parse(xhr.responseText) as ApiError
      } catch {
        // Non-JSON error body — keep the status-code message.
      }
      if (xhr.status === 401) handleUnauthorized()
      resolve({ data: null, error })
    }
    xhr.onerror = () => resolve({ data: null, error: { message: 'Network error' } })
    xhr.onabort = () => resolve({ data: null, error: { message: 'Upload cancelled' } })

    const body = new FormData()
    body.append('file', file)
    xhr.send(body)
  })
}

/**
 * Deletes the asset itself, not just its use on a recipe. Removing a photo from
 * a recipe is a recipe edit — this is for discarding an upload outright.
 */
export function deleteAsset(id: string): Promise<ApiResult<null>> {
  return apiRequest<null>(`/api/media/${id}`, { method: 'DELETE' })
}
