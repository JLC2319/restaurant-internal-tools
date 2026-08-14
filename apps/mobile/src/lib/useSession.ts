import { useSyncExternalStore } from 'react';
import { getSession, subscribeSession } from '../api/client';

/**
 * The session as React state. Screens guard on it: no token → /login, token
 * but no scope → /scope. Because a 401 clears the token in the store, an
 * expired session redirects from wherever the user happens to be.
 */
export function useSession() {
  return useSyncExternalStore(subscribeSession, getSession, getSession);
}
