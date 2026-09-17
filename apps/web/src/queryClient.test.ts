import { describe, expect, it } from 'vitest';

import {
  createQueryClient,
  DEFAULT_GC_TIME_MS,
  DEFAULT_MUTATION_RETRIES,
  DEFAULT_QUERY_RETRIES,
  DEFAULT_STALE_TIME_MS,
} from './queryClient';

describe('createQueryClient', () => {
  it('returns a fresh, isolated client per call', () => {
    expect(createQueryClient()).not.toBe(createQueryClient());
  });

  it('applies the default server-state caching policy', () => {
    const client = createQueryClient();
    const queries = client.getDefaultOptions().queries;

    expect(queries?.staleTime).toBe(DEFAULT_STALE_TIME_MS);
    expect(queries?.gcTime).toBe(DEFAULT_GC_TIME_MS);
    expect(queries?.retry).toBe(DEFAULT_QUERY_RETRIES);
    expect(queries?.refetchOnWindowFocus).toBe(true);
  });

  it('never auto-retries mutations', () => {
    const client = createQueryClient();

    expect(client.getDefaultOptions().mutations?.retry).toBe(DEFAULT_MUTATION_RETRIES);
  });

  it('is a no-op when a query client with identical defaults is reused', () => {
    // Guards against accidental per-call mutation of the shared options:
    // two clients built from the same factory must report identical defaults.
    const a = createQueryClient().getDefaultOptions();
    const b = createQueryClient().getDefaultOptions();

    expect(a.queries?.staleTime).toBe(b.queries?.staleTime);
    expect(a.queries?.gcTime).toBe(b.queries?.gcTime);
  });
});
