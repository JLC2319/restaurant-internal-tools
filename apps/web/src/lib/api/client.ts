import type { ApiError, ApiResult } from '@rit/shared'

/** Exported for the one caller (video upload) that needs XHR instead of fetch. */
export const BASE_URL = (import.meta.env.PUBLIC_API_BASE_URL ?? 'http://localhost:9317').replace(
  /\/$/,
  ''
)

/** localStorage keys. Prefixed so nothing collides on a shared kitchen iPad. */
export const TOKEN_KEY = 'rit_token'
export const SCOPE_KEY = 'rit_scope'

/** The tenant scope the user is currently acting in. */
export interface ActiveScope {
  orgId: string
  propertyId?: string | null
  locationId?: string | null
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
  document.documentElement.setAttribute('data-authed', '')
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(SCOPE_KEY)
  document.documentElement.removeAttribute('data-authed')
}

export function getScope(): ActiveScope | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(SCOPE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as ActiveScope
  } catch {
    return null
  }
}

export function setScope(scope: ActiveScope): void {
  localStorage.setItem(SCOPE_KEY, JSON.stringify(scope))
}

/**
 * React-query cache-key triple for the active scope, null fallbacks. Feature
 * modules re-export this so every scoped query key carries the scope — a scope
 * switch can never serve one tenant's data under another's header.
 */
export function scopeKey(): (string | null)[] {
  const scope = getScope()
  return [scope?.orgId ?? null, scope?.propertyId ?? null, scope?.locationId ?? null]
}

/**
 * Builds a list-endpoint query string: '' when nothing is set, otherwise a
 * ready-to-append '?...'. Falsy values mean "not filtering" — the same truthy
 * checks the list callers used when they built URLSearchParams inline.
 */
export function buildQuery(
  params: Record<string, string | number | boolean | undefined>
): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, String(value))
  }
  const qs = query.toString()
  return qs ? `?${qs}` : ''
}

/**
 * Called whenever the API returns 401. Clears the stored auth and sends the
 * user back to login rather than leaving them on a page that will never load.
 */
export function handleUnauthorized(): void {
  if (typeof window === 'undefined') return
  if (!getToken()) return
  clearAuth()
  window.location.href = '/login'
}

/** The API answers 403 "suspended" for a disabled account. */
export function handleSuspended(): void {
  if (typeof window === 'undefined') return
  clearAuth()
  window.location.href = '/login?suspended=1'
}

/**
 * Auth + tenant-scope headers as a plain record — shared with the one caller
 * (the XHR video upload) that cannot go through `apiRequest`.
 */
export function buildAuthScopeHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}

  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const scope = getScope()
  if (scope?.orgId) headers['X-Org-Id'] = scope.orgId
  if (scope?.propertyId) headers['X-Property-Id'] = scope.propertyId
  if (scope?.locationId) headers['X-Location-Id'] = scope.locationId

  return headers
}

/**
 * The tenant scope travels in headers, not in the URL, so every request goes
 * through here rather than calling fetch directly — a request that forgets the
 * scope headers gets a 400 from `resolveTenant`, not silently wrong data.
 */
function buildHeaders(
  extra: HeadersInit | undefined,
  withScope: boolean,
  isMultipart: boolean
): HeadersInit {
  // A FormData body must set its own Content-Type: the browser appends the
  // multipart boundary, and hard-coding the header strips it — multer then sees
  // a body it cannot parse and every field arrives undefined.
  const headers: Record<string, string> = isMultipart
    ? {}
    : { 'Content-Type': 'application/json' }

  if (withScope) {
    Object.assign(headers, buildAuthScopeHeaders())
  } else {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  return { ...headers, ...(extra as Record<string, string> | undefined) }
}

export interface RequestOptions extends RequestInit {
  /** Set false for routes that run outside a tenant scope (login, register). */
  scoped?: boolean
}

/**
 * Every client fetch function returns `ApiResult<T>`. Callers check
 * `result.error` first — never assume success.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const { scoped = true, headers, ...rest } = options

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...rest,
      headers: buildHeaders(headers, scoped, rest.body instanceof FormData),
    })

    if (!response.ok) {
      let error: ApiError = { message: `HTTP ${response.status}` }
      try {
        error = (await response.json()) as ApiError
      } catch {
        // Non-JSON error body — keep the status-code message.
      }

      if (response.status === 401) handleUnauthorized()
      if (response.status === 403 && error.message?.toLowerCase().includes('suspended')) {
        handleSuspended()
      }

      return { data: null, error }
    }

    if (response.status === 204) {
      return { data: null as unknown as T, error: null }
    }

    return { data: (await response.json()) as T, error: null }
  } catch (err) {
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : 'Network error' },
    }
  }
}
