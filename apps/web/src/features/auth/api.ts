import type {
  ApiResult,
  AuthUser,
  ChangePasswordInput,
  LoginInput,
  LoginResponse,
  MembershipSummary,
  RegisterInput,
  RegisterResponse,
  UpdateMeInput,
} from '@rit/shared'
import { apiRequest } from '@/lib/api/client'

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

export function updateMe(input: UpdateMeInput): Promise<ApiResult<AuthUser>> {
  return apiRequest<AuthUser>('/api/auth/me', {
    method: 'PATCH',
    body: JSON.stringify(input),
    scoped: false,
  })
}

export function changePassword(input: ChangePasswordInput): Promise<ApiResult<null>> {
  return apiRequest<null>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify(input),
    scoped: false,
  })
}
