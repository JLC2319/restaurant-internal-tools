import type {
  ApiResult,
  AuthUser,
  LoginInput,
  LoginResponse,
  MembershipSummary,
  RegisterInput,
  RegisterResponse,
} from '@rit/shared'
import { apiRequest } from './client'

export function login(input: LoginInput): Promise<ApiResult<LoginResponse>> {
  return apiRequest<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
    scoped: false,
  })
}

export function register(input: RegisterInput): Promise<ApiResult<RegisterResponse>> {
  return apiRequest<RegisterResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
    scoped: false,
  })
}

export function getMe(): Promise<ApiResult<AuthUser>> {
  return apiRequest<AuthUser>('/api/auth/me', { scoped: false })
}

export function getMyMemberships(): Promise<ApiResult<MembershipSummary[]>> {
  return apiRequest<MembershipSummary[]>('/api/auth/me/memberships', { scoped: false })
}
