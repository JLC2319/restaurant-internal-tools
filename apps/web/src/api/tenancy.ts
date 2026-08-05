import type {
  ApiResult,
  CreateLocationInput,
  CreateOrganizationInput,
  CreatePropertyInput,
  LocationSummary,
  OrganizationSummary,
  PropertySummary,
  TenantTree,
} from '@rit/shared'
import { apiRequest } from './client'

export function getOrganization(): Promise<ApiResult<OrganizationSummary>> {
  return apiRequest<OrganizationSummary>('/api/tenancy/organization')
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
