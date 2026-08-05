import type {
  ApiResult,
  CreateLocationInput,
  CreateOrganizationInput,
  CreatePropertyInput,
  InviteMemberInput,
  LocationSummary,
  OrganizationProfile,
  OrganizationSummary,
  OrgMemberRow,
  PaginatedResponse,
  PropertySummary,
  TenantTree,
  UpdateMembershipInput,
  UpdateOrganizationInput,
} from '@rit/shared'
import { apiRequest, getScope } from './client'

/** Cache-key fragment for queries that change with the active scope. */
export function tenancyScopeKey(): string[] {
  const scope = getScope()
  return [scope?.orgId ?? '', scope?.propertyId ?? '', scope?.locationId ?? '']
}

export function getOrganization(): Promise<ApiResult<OrganizationProfile>> {
  return apiRequest<OrganizationProfile>('/api/tenancy/organization')
}

export function updateOrganization(
  input: UpdateOrganizationInput
): Promise<ApiResult<OrganizationProfile>> {
  return apiRequest<OrganizationProfile>('/api/tenancy/organization', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function listMembers(page = 1): Promise<ApiResult<PaginatedResponse<OrgMemberRow>>> {
  return apiRequest<PaginatedResponse<OrgMemberRow>>(`/api/tenancy/members?page=${page}`)
}

export function inviteMember(
  input: InviteMemberInput
): Promise<ApiResult<{ membershipId: string; userExists: boolean }>> {
  return apiRequest<{ membershipId: string; userExists: boolean }>('/api/tenancy/members', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateMembership(
  membershipId: string,
  input: UpdateMembershipInput
): Promise<ApiResult<null>> {
  return apiRequest<null>(`/api/tenancy/members/${membershipId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function revokeMembership(membershipId: string): Promise<ApiResult<null>> {
  return apiRequest<null>(`/api/tenancy/members/${membershipId}`, { method: 'DELETE' })
}

/** The org → property → location tree, narrowed to what the caller may see. */
export function getTenantTree(): Promise<ApiResult<TenantTree>> {
  return apiRequest<TenantTree>('/api/tenancy/tree')
}

export function createOrganization(
  input: CreateOrganizationInput
): Promise<ApiResult<OrganizationSummary>> {
  // Runs before any scope exists, so it must not send the tenant headers.
  return apiRequest<OrganizationSummary>('/api/tenancy/organizations', {
    method: 'POST',
    body: JSON.stringify(input),
    scoped: false,
  })
}

export function listProperties(): Promise<ApiResult<PropertySummary[]>> {
  return apiRequest<PropertySummary[]>('/api/tenancy/properties')
}

export function createProperty(input: CreatePropertyInput): Promise<ApiResult<PropertySummary>> {
  return apiRequest<PropertySummary>('/api/tenancy/properties', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function listLocations(propertyId?: string): Promise<ApiResult<LocationSummary[]>> {
  const query = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : ''
  return apiRequest<LocationSummary[]>(`/api/tenancy/locations${query}`)
}

export function createLocation(input: CreateLocationInput): Promise<ApiResult<LocationSummary>> {
  return apiRequest<LocationSummary>('/api/tenancy/locations', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
