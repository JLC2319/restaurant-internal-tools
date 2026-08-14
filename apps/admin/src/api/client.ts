import type { ApiError, ApiResult } from '@rit/shared';

const BASE_URL = (import.meta.env.PUBLIC_API_BASE_URL ?? 'http://localhost:9317').replace(
  /\/$/,
  '',
);

/**
 * Deliberately not `rit_token`: on localhost the two apps share an origin per
 * port, but a different key keeps a dev signed into the console and the
 * customer app at once without the sessions treading on each other.
 */
export const TOKEN_KEY = 'rit_admin_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  document.documentElement.setAttribute('data-authed', '');
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  document.documentElement.removeAttribute('data-authed');
}

/**
 * Called whenever the API returns 401. Clears the stored auth and sends the
 * user back to login rather than leaving them on a page that will never load.
 */
export function handleUnauthorized(): void {
  if (typeof window === 'undefined') return;
  if (!getToken()) return;
  clearAuth();
  window.location.href = '/login';
}

/** The API answers 403 "suspended" for a disabled account. */
export function handleSuspended(): void {
  if (typeof window === 'undefined') return;
  clearAuth();
  window.location.href = '/login?suspended=1';
}

function buildHeaders(extra: HeadersInit | undefined): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  return { ...headers, ...(extra as Record<string, string> | undefined) };
}

/**
 * Every console fetch goes through here. No scope headers — the platform
 * routes are cross-tenant by design. Callers check `result.error` first.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResult<T>> {
  const { headers, ...rest } = options;

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...rest,
      headers: buildHeaders(headers),
    });

    if (!response.ok) {
      let error: ApiError = { message: `HTTP ${response.status}` };
      try {
        error = (await response.json()) as ApiError;
      } catch {
        // Non-JSON error body — keep the status-code message.
      }

      if (response.status === 401) handleUnauthorized();
      if (response.status === 403 && error.message?.toLowerCase().includes('suspended')) {
        handleSuspended();
      }

      return { data: null, error };
    }

    if (response.status === 204) {
      return { data: null as unknown as T, error: null };
    }

    return { data: (await response.json()) as T, error: null };
  } catch (err) {
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : 'Network error' },
    };
  }
}
