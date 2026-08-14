import type {
  AccessCandidate,
  ApiResult,
  CreateTrainingInput,
  MoveTrainingInput,
  PaginatedResponse,
  TrainingCompletionRow,
  TrainingCompletionState,
  TrainingDetail,
  TrainingStatus,
  TrainingSummary,
  UpdateTrainingAccessInput,
  UpdateTrainingInput,
} from '@rit/shared'
import { apiRequest, getScope } from './client'

/**
 * Query-key prefix segment for the active scope — same rule as recipes: a
 * scope switch must never serve one tenant's trainings under another's header.
 */
export function trainingsScopeKey(): (string | null)[] {
  const scope = getScope()
  return [scope?.orgId ?? null, scope?.propertyId ?? null, scope?.locationId ?? null]
}

export interface ListTrainingsParams {
  q?: string
  page?: number
  limit?: number
  status?: TrainingStatus
}

export function listTrainings(
  params: ListTrainingsParams = {}
): Promise<ApiResult<PaginatedResponse<TrainingSummary>>> {
  const query = new URLSearchParams()
  if (params.q) query.set('q', params.q)
  if (params.page) query.set('page', String(params.page))
  if (params.limit) query.set('limit', String(params.limit))
  if (params.status) query.set('status', params.status)
  const qs = query.toString()
  return apiRequest<PaginatedResponse<TrainingSummary>>(`/api/training${qs ? `?${qs}` : ''}`)
}

export function getTraining(id: string): Promise<ApiResult<TrainingDetail>> {
  return apiRequest<TrainingDetail>(`/api/training/${id}`)
}

export function createTraining(input: CreateTrainingInput): Promise<ApiResult<TrainingDetail>> {
  return apiRequest<TrainingDetail>('/api/training', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateTraining(
  id: string,
  input: UpdateTrainingInput
): Promise<ApiResult<TrainingDetail>> {
  return apiRequest<TrainingDetail>(`/api/training/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function publishTraining(id: string): Promise<ApiResult<TrainingDetail>> {
  return apiRequest<TrainingDetail>(`/api/training/${id}/publish`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function unpublishTraining(id: string): Promise<ApiResult<TrainingDetail>> {
  return apiRequest<TrainingDetail>(`/api/training/${id}/unpublish`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function archiveTraining(id: string): Promise<ApiResult<null>> {
  return apiRequest<null>(`/api/training/${id}`, { method: 'DELETE' })
}

export function unarchiveTraining(id: string): Promise<ApiResult<TrainingDetail>> {
  return apiRequest<TrainingDetail>(`/api/training/${id}/unarchive`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function completeTraining(id: string): Promise<ApiResult<TrainingCompletionState>> {
  return apiRequest<TrainingCompletionState>(`/api/training/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function uncompleteTraining(id: string): Promise<ApiResult<TrainingCompletionState>> {
  return apiRequest<TrainingCompletionState>(`/api/training/${id}/complete`, {
    method: 'DELETE',
  })
}

export function listCompletions(id: string): Promise<ApiResult<TrainingCompletionRow[]>> {
  return apiRequest<TrainingCompletionRow[]>(`/api/training/${id}/completions`)
}

/** Move the module to a new home in the tree; the server re-validates everything placement touches. */
export function moveTraining(
  id: string,
  input: MoveTrainingInput
): Promise<ApiResult<TrainingDetail>> {
  return apiRequest<TrainingDetail>(`/api/training/${id}/scope`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

/** Replace the person-level allow-list wholesale; `access: null` clears it. */
export function updateTrainingAccess(
  id: string,
  input: UpdateTrainingAccessInput
): Promise<ApiResult<TrainingDetail>> {
  return apiRequest<TrainingDetail>(`/api/training/${id}/access`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

/** Everyone the allow-list may name: members whose scope covers this module. */
export function listTrainingAccessCandidates(id: string): Promise<ApiResult<AccessCandidate[]>> {
  return apiRequest<AccessCandidate[]>(`/api/training/${id}/access/candidates`)
}
