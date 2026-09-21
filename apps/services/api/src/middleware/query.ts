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
    const params = request.query as
      | { include?: unknown; filter?: unknown; page?: unknown; per_page?: unknown }
      | undefined;
    (request as FastifyRequest & { queryParsed?: QueryParsed }).queryParsed =
      params == null
        ? { includes: { relations: new Set() }, filters: { clauses: [] }, pagination: { page: 1, perPage: 20, offset: 0, limit: 20 } }
        : parseQuery(params);
  });
}

export type { ParsedQuery, QueryParsed };
