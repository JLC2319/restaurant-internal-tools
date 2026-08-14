import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ApiError, ApiResult } from '@rit/shared';

/**
 * The mobile twin of apps/web/src/lib/api/client.ts. Same request contract —
 * bearer token plus X-Org-Id / X-Property-Id / X-Location-Id headers on every
 * scoped call, `ApiResult<T>` out — but storage is different: AsyncStorage is
 * asynchronous, so the session lives in module memory (synchronously readable
 * by every fetch function and hook) and AsyncStorage is only the durable copy.
 * `hydrateSession()` loads it once at app start, before the router mounts.
 */

export const BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:9317').replace(
  /\/$/,
  '',
);

/** Same keys as the web app — prefixed so nothing collides on a shared device. */
const TOKEN_KEY = 'rit_token';
const SCOPE_KEY = 'rit_scope';

/** The tenant scope the user is currently acting in. */
export interface ActiveScope {
  orgId: string;
  propertyId?: string | null;
  locationId?: string | null;
}

interface Session {
  hydrated: boolean;
  token: string | null;
  scope: ActiveScope | null;
  /** Why the session was cleared out from under the user ("Session expired"). */
  notice: string | null;
}

let session: Session = { hydrated: false, token: null, scope: null, notice: null };

const listeners = new Set<() => void>();

function emit(next: Partial<Session>): void {
  session = { ...session, ...next };
  for (const listener of listeners) listener();
}

/** For useSyncExternalStore — the session is the app's one piece of global state. */
export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSession(): Session {
  return session;
}

/** Load the persisted session into memory. Call once, before rendering routes. */
export async function hydrateSession(): Promise<void> {
  try {
    const entries = await AsyncStorage.multiGet([TOKEN_KEY, SCOPE_KEY]);
    const token = entries.find(([key]) => key === TOKEN_KEY)?.[1] ?? null;
    const rawScope = entries.find(([key]) => key === SCOPE_KEY)?.[1] ?? null;
    let scope: ActiveScope | null = null;
    if (rawScope) {
      try {
        scope = JSON.parse(rawScope) as ActiveScope;
      } catch {
        scope = null;
      }
    }
    emit({ hydrated: true, token, scope });
  } catch {
    // Storage unreadable — start signed out rather than not starting at all.
    emit({ hydrated: true, token: null, scope: null });
  }
}

export function getToken(): string | null {
  return session.token;
}

export function getScope(): ActiveScope | null {
  return session.scope;
}

export function setToken(token: string): void {
  emit({ token, notice: null });
  void AsyncStorage.setItem(TOKEN_KEY, token);
}

export function setScope(scope: ActiveScope): void {
  emit({ scope });
  void AsyncStorage.setItem(SCOPE_KEY, JSON.stringify(scope));
}

export function clearAuth(notice: string | null = null): void {
  emit({ token: null, scope: null, notice });
  void AsyncStorage.multiRemove([TOKEN_KEY, SCOPE_KEY]);
}

/** Read-and-clear: the login screen shows the notice once. */
export function takeNotice(): string | null {
  const notice = session.notice;
  if (notice) emit({ notice: null });
  return notice;
}

/**
 * Called whenever the API returns 401. Clearing the token flips every
 * screen's session guard, which redirects to /login — no router import here.
 */
function handleUnauthorized(): void {
  if (!session.token) return;
  clearAuth('Your session expired. Please sign in again.');
}

/** The API answers 403 "suspended" for a disabled account. */
function handleSuspended(): void {
  clearAuth('This account has been suspended. Talk to your manager.');
}

function buildHeaders(extra: HeadersInit | undefined, withScope: boolean): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (session.token) headers.Authorization = `Bearer ${session.token}`;

  if (withScope) {
    const scope = session.scope;
    if (scope?.orgId) headers['X-Org-Id'] = scope.orgId;
    if (scope?.propertyId) headers['X-Property-Id'] = scope.propertyId;
    if (scope?.locationId) headers['X-Location-Id'] = scope.locationId;
  }

  return { ...headers, ...(extra as Record<string, string> | undefined) };
}

export interface RequestOptions extends RequestInit {
  /** Set false for routes that run outside a tenant scope (login, memberships). */
  scoped?: boolean;
}

/**
 * Every client fetch function returns `ApiResult<T>`. Callers check
 * `result.error` first — never assume success.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  const { scoped = true, headers, ...rest } = options;

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...rest,
      headers: buildHeaders(headers, scoped),
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
