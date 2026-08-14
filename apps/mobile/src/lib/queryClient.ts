import { QueryClient } from '@tanstack/react-query';

/**
 * One QueryClient for the whole app, importable outside React so the scope
 * switcher can wipe it. Every cached query is scope-dependent; keeping any of
 * it across a scope change would show one tenant's data under another's
 * header. The web app hard-reloads the page for this — `clear()` is the
 * native equivalent.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});
