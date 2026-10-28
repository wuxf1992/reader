import { QueryClient } from '@tanstack/react-query';

export function createAppQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: {
    // Run local-cache fallbacks even after the browser reports no network.
    networkMode: 'offlineFirst',
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  } } });
}
