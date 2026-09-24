/** @license
 * BE-001e: Query parameter middleware — include, filter, pagination.
 *
 * Parses the standard list-query query string (`include[]`, `filter[]` /
 * `filter[field]`, `page`, `per_page`) into typed, validation-friendly
 * structures that route handlers consume when building Drizzle queries.
 *
 * Scope of BE-001e (unit tests only, per task spec):
 *  - Pure parsing functions (no Fastify dependency) — the bulk of the
 *    module, fully covered by unit tests.
 *  - A Fastify `preHandler` hook factory that calls the pure functions and
 *    decorations `request.queryParsed` for downstream route handlers.
 *
 * Design notes (ADR-004 §query, ADR-003 §9.1 indexes):
 *  - Parsing is conservative: malformed clauses are silently dropped with
 *    a debug-level log, not surfaced as 400 to the caller. This keeps the
 *    API tolerant of client bugs while still surfacing abuse patterns to
 *    operators. A future validation layer (BE-003c+) can tighten this.
 *  - `include[]` values are limited to the relation names the route layer
 *    knows how to eager-load; unknown values are dropped, not rejected.
 *  - `per_page` is capped at MAX_PER_PAGE (100) to prevent unbounded scans.
 *  - `page` starts at 1; values below 1 are clamped to 1.
 *  - Filter operators are a fixed enum — no user-supplied operator strings
 *    reach the query builder.
 *
 * Security (SEC-001 AR-2): parsing produces no secrets. Filter values are
 * strings; the route layer is responsible for parameterized query building
 * so that no filter value is ever interpolated into SQL/ORM calls.
 *
 * NOTE: The pure parsing functions (parseIncludes, parseFilters,
 * parsePagination, parseQuery) and their types live in
 * apps/services/api/src/middleware/query-parse.ts — a local mirror of
 * packages/shared/src/query.ts. Import from the local mirror, not from
 * @shared/query, to avoid a rootDir violation (the api tsconfig's paths
 * alias points outside rootDir). Keep the two in sync until packages/shared
 * is set up as a built workspace package.
 */

import { parseIncludes, parseFilters, parsePagination, parseQuery } from './query-parse';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ParsedQuery, QueryParsed } from './query-parse';

// Route handlers read `request.queryParsed` directly (typed, no cast)
// once this plugin's preHandler hook has run. Declared here — the single
// place that writes the decoration — rather than per-consumer.
declare module 'fastify' {
  interface FastifyRequest {
    queryParsed: QueryParsed;
  }
}

/** Register a `preHandler` hook on the given Fastify instance that parses
 *  the query string and decorates each `request` with `queryParsed`.
 *
 *  Usage in a route plugin:
 *    queryPreHandler(fastify);
 *    fastify.get('/api/v1/resources', { config: { operationId: 'ListResources' } },
 *      async (req, reply) => {
 *        const q = req.queryParsed;
 *        // q.includes, q.filters, q.pagination ready for the query builder
 *      });
 *
 *  Routes that don't need query parsing can skip calling this — the hook is
 *  opt-in per-plugin rather than global, unlike the envelope hook which runs
 *  at root scope.
 */
export function queryPreHandler(server: FastifyInstance): void {
  server.addHook('preHandler', async (request: FastifyRequest, _reply) => {
    // Fastify already parsed the query string into `request.query` per the
    // route schema (if any) or the default parser. We re-parse the raw
    // shapes into our typed structures.
    const params = request.query as Record<string, unknown> | undefined;
    if (params == null) {
      (request as FastifyRequest & { queryParsed?: QueryParsed }).queryParsed = {
        includes: { relations: new Set() },
        filters: { clauses: [] },
        pagination: { page: 1, perPage: 20, offset: 0, limit: 20 },
      };
      return;
    }
    const { include, filter } = collectBracketed(params);
    (request as FastifyRequest & { queryParsed?: QueryParsed }).queryParsed = parseQuery({
      include,
      filter,
      page: params.page,
      per_page: params.per_page,
    });
  });
}

/**
 * Normalize the bracket-style query keys ADR-004 actually specifies
 * (`filter[]=...`, `filter[field]=value`, `include[]=...`) into the plain
 * `filter`/`include` string-array shape `parseQuery` expects.
 *
 * Fastify's default query-string parser (no `qs`/bracket-nesting plugin
 * installed) does NOT nest bracket keys into objects or arrays — it hands
 * back literal keys like `"filter[search]"` and `"filter[]"` untouched.
 * Without this normalization, every bracket-form query in the ADR-004
 * contract (including this task's own `GET /resources?filter[search]=...`
 * example) would silently parse to nothing — `queryPreHandler` only ever
 * looked at the flat `filter`/`include` keys, which a bracket-style
 * request never populates. Discovered while implementing BE-003h.
 *
 * `filter[field]=value` is folded into the same `"field:contains:value"`-
 * style clause strings `filter[]=field:op:value` already produces (via the
 * `field:value` composition parseFilters' object-form path also uses),
 * so a single call to `parseFilters` on a flat string array handles every
 * input shape uniformly.
 */
function collectBracketed(params: Record<string, unknown>): { include: string[]; filter: string[] } {
  const include: string[] = [];
  const filter: string[] = [];

  const pushAll = (target: string[], value: unknown) => {
    if (typeof value === 'string') target.push(value);
    else if (Array.isArray(value)) {
      for (const item of value) if (typeof item === 'string') target.push(item);
    }
  };

  pushAll(include, params.include);
  pushAll(include, params['include[]']);
  pushAll(filter, params.filter);
  pushAll(filter, params['filter[]']);

  const bracketFieldPattern = /^filter\[([^[\]]+)\]$/;
  for (const [key, value] of Object.entries(params)) {
    const match = bracketFieldPattern.exec(key);
    if (!match) continue;
    const field = match[1];
    if (typeof value === 'string') {
      filter.push(`${field}:${value}`);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') filter.push(`${field}:${item}`);
      }
    }
  }

  return { include, filter };
}

export type { ParsedQuery, QueryParsed };
