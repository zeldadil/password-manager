import { QueryClient } from '@tanstack/react-query'

/**
 * Default caching policy for the Password Manager's server state.
 *
 * React Query (TanStack Query v5) owns *server* state — resources, folders,
 * tags, vault metadata, session status. Those values are cacheable and can be
 * refetched/stale-while-revalidate'd safely because the API is the source of
 * truth.
 *
 * Sensitive values (vault key, decrypted resource secrets) are deliberately
 * NOT cached here. They live in ephemeral React state and are cleared on
 * lock/navigation — see SEC-001 and apps/web/README.md security note.
 */

/** Time (ms) a server-state query is considered fresh before it refetches. */
export const DEFAULT_STALE_TIME_MS = 30_000;

/** Time (ms) inactive query data is retained in the cache after its last observer unmounts. */
export const DEFAULT_GC_TIME_MS = 5 * 60_000;

/** Retry count for failed reads (transient network errors only). */
export const DEFAULT_QUERY_RETRIES = 2;

/** Retry count for failed writes — mutations are never auto-retried (idempotency risk). */
export const DEFAULT_MUTATION_RETRIES = 0;

/**
 * Build a fresh {@link QueryClient} with the project's default options.
 *
 * Exposed as a factory (rather than a single module-level singleton) so tests
 * and future server-side rendering can construct isolated clients with
 * identical defaults.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME_MS,
        gcTime: DEFAULT_GC_TIME_MS,
        retry: DEFAULT_QUERY_RETRIES,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: DEFAULT_MUTATION_RETRIES,
      },
    },
  });
}

/** The application-wide query client, mounted once at the app root in `main.tsx`. */
export const queryClient = createQueryClient();
