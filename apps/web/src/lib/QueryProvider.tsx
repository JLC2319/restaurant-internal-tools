import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * Module singleton, deliberately. Astro remounts islands on navigation, and a
 * per-mount client would throw away the cache on every page change.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Kitchen Wi-Fi drops constantly; a failed fetch is usually transient.
      retry: 2,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

export function QueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export { queryClient };
