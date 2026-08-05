import type {
  ApiResult,
  OrganizationSummary,
  PaginatedResponse,
  PlatformCreateOrganizationInput,
  PlatformOrganizationDetail,
  PlatformOrganizationRow,
  PlatformStats,
  PlatformUpdateOrganizationInput,
  PlatformUpdateUserInput,
  PlatformUserRow,
} from '@rit/shared'
import { apiRequest } from './client'

export interface ListParams {
  q?: string
  page?: number
}

function listQuery(params: ListParams): string {
  const qs = new URLSearchParams()
  if (params.q) qs.set('q', params.q)
  if (params.page && params.page > 1) qs.set('page', String(params.page))
  const s = qs.toString()
  return s ? `?${s}` : ''
}

export function getStats(): Promise<ApiResult<PlatformStats>> {
  return apiRequest<PlatformStats>('/api/platform/stats')
}

export function listOrganizations(
  params: ListParams = {}
): Promise<ApiResult<PaginatedResponse<PlatformOrganizationRow>>> {
  return apiRequest(`/api/platform/organizations${listQuery(params)}`)
}

export function createOrganization(
  input: PlatformCreateOrganizationInput
): Promise<ApiResult<OrganizationSummary>> {
  return apiRequest('/api/platform/organizations', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function getOrganizationDetail(id: string): Promise<ApiResult<PlatformOrganizationDetail>> {
  return apiRequest(`/api/platform/organizations/${id}`)
}

export function updateOrganization(
  id: string,
  input: PlatformUpdateOrganizationInput
): Promise<ApiResult<OrganizationSummary>> {
  return apiRequest(`/api/platform/organizations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function listUsers(
  params: ListParams = {}
): Promise<ApiResult<PaginatedResponse<PlatformUserRow>>> {
  return apiRequest(`/api/platform/users${listQuery(params)}`)
}

export function updateUser(
  id: string,
  input: PlatformUpdateUserInput
): Promise<ApiResult<PlatformUserRow>> {
  return apiRequest(`/api/platform/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}
