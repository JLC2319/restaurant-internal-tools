import type {
  ApiResult,
  PaginatedResponse,
  TrainingCompletionState,
  TrainingDetail,
  TrainingStatus,
  TrainingSummary,
} from '@rit/shared';
import { apiRequest, getScope } from './client';

/** Same scope-in-the-key rule as recipes. */
export function trainingsScopeKey(): (string | null)[] {
  const scope = getScope();
  return [scope?.orgId ?? null, scope?.propertyId ?? null, scope?.locationId ?? null];
}

export interface ListTrainingsParams {
  q?: string;
  page?: number;
  limit?: number;
  status?: TrainingStatus;
}

export function listTrainings(
  params: ListTrainingsParams = {},
): Promise<ApiResult<PaginatedResponse<TrainingSummary>>> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.status) query.set('status', params.status);
  const qs = query.toString();
  return apiRequest<PaginatedResponse<TrainingSummary>>(`/api/training${qs ? `?${qs}` : ''}`);
}

export function getTraining(id: string): Promise<ApiResult<TrainingDetail>> {
  return apiRequest<TrainingDetail>(`/api/training/${id}`);
}

export function completeTraining(id: string): Promise<ApiResult<TrainingCompletionState>> {
  return apiRequest<TrainingCompletionState>(`/api/training/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function uncompleteTraining(id: string): Promise<ApiResult<TrainingCompletionState>> {
  return apiRequest<TrainingCompletionState>(`/api/training/${id}/complete`, {
    method: 'DELETE',
  });
}
