import type { ApiResult, AuthUser, LoginInput, LoginResponse } from '@rit/shared'
import { apiRequest } from './client'

export function login(input: LoginInput): Promise<ApiResult<LoginResponse>> {
  return apiRequest<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function getMe(): Promise<ApiResult<AuthUser>> {
  return apiRequest<AuthUser>('/api/auth/me')
}
