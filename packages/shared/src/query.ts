/** @license
 * ADR-004 query parsing — shared TypeScript types and pure parsing functions.
 *
 * Single source of truth for query-parameter shapes consumed by the API
 * server (apps/services/api) and, later, the web client fetch wrapper
 * (FE-001f). Imported from packages/shared per ADR-002 §2.3.
 *
 * Security (SEC-001 AR-2): these types and functions carry no secret values —
 * they are pure transport/parsing descriptors. Fields reference entity column
 * names and filter operators only. No DB queries, no secrets.
 */

// ─── Include (eager loading) ──────────────────────────────────────────────

/** Allowed `include[]` values — the relation names the API knows how to
 *  eager-load alongside a primary collection response.
 *
 *  Narrows to the relations that exist on the resource domain tables in
 *  ADR-003 (permissions, tags, folder, group). Adding a new value here
 *  requires a matching loader in the route layer.
 */
export type IncludeRelation =
  | 'permissions'
  | 'tags'
  | 'folder'
  | 'group';

/** Parsed `include` query parameter — the set of relations the caller
 *  requested to be eager-loaded.
 */
export interface ParsedIncludes {
  /** The requested relations, de-duplicated and validated. Empty when
   *  no `include` / `include[]` was supplied or every value was invalid. */
  relations: ReadonlySet<IncludeRelation>;
}

// ─── Filter ───────────────────────────────────────────────────────────────

/** Supported filter operators.
 *
 *  * `eq`  — equals
 *  * `ne`  — not equals
 *  * `gt`  — strictly greater than (numeric / datetime)
 *  * `gte` — greater than or equal
 *  * `lt`  — strictly less than
 *  * `lte` — less than or equal
 *  * `contains` — case-sensitive substring match (text columns)
 *  * `in`  — value is one of a comma-separated list
 */
export type FilterOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'in';

/** A single parsed filter clause.
 *
 *  The *raw* text supplied by the caller is preserved on `raw` so that
 *  route-level validation / logging can re-emit it if needed, but the
 *  active parts are typed.
 */
export interface FilterClause {
  /** Entity column / field name the filter applies to (e.g. "name",
   *  "created_at", "type"). Must match a known column for the entity
   *  being queried — validated at the route layer, not here. */
  field: string;
  /** Comparison operator. */
  operator: FilterOperator;
  /** The operand. For `in` this is the raw comma-separated string; the
   *  route layer splits it. For other operators it is the literal value
   *  to compare against. */
  value: string;
  /** Original, un-trimmed raw text of the clause (for logging/debug). */
  raw: string;
}

/** Parsed `filter` / `filter[]` query parameter.
 *
 *  Examples (all equivalent):
 *    ?filter=name:contains:Servers
 *    ?filter[]=name:contains:Servers
 *    ?filter[name]=contains:Servers
 *    ?filter[]=created_at:gte:2026-01-01T00:00:00Z&filter[]=type:eq:server
 */
export interface ParsedFilters {
  /** The parsed filter clauses, in the order they were supplied.
   *  Empty when no `filter` / `filter[]` was supplied. */
  clauses: ReadonlyArray<FilterClause>;
}

// ─── Pagination ───────────────────────────────────────────────────────────

/** Parsed pagination parameters.
 *
 *  * `page`     — 1-based page number (default 1, min 1).
 *  * `per_page` — items per page (default 20, min 1, max 100).
 *
 *  The middleware also exposes `offset` and `limit` for convenience when
 *  building raw SQL / Drizzle queries.
 */
export interface ParsedPagination {
  /** 1-based page number. */
  page: number;
  /** Items per page (capped at MAX_PER_PAGE). */
  perPage: number;
  /** Zero-based offset computed as `(page - 1) * perPage`. */
  offset: number;
  /** Cap applied to the query (`perPage`). */
  limit: number;
}

/** Maximum allowed `per_page` value. Prevents a caller from requesting
 *  an unbounded result set under the guise of pagination. */
export const MAX_PER_PAGE = 100;

// ─── Combined query shape ─────────────────────────────────────────────────

/** Everything the query middleware extracts from the incoming request's
 *  query string for list endpoints.
 */
export interface ParsedQuery {
  includes: ParsedIncludes;
  filters: ParsedFilters;
  pagination: ParsedPagination;
}

/** Alias for ParsedQuery, used to type the Fastify request decoration
 *  (`request.queryParsed`). Kept as a separate export so the middleware
 *  can import only the type it needs without pulling in the parsing
 *  functions (which have a different consumer profile).
 */
export type QueryParsed = ParsedQuery;

// ─── Pure parsing functions ───────────────────────────────────────────────

const VALID_INCLUDES: ReadonlySet<IncludeRelation> = new Set([
  'permissions',
  'tags',
  'folder',
  'group',
]);

const VALID_OPERATORS: ReadonlySet<FilterOperator> = new Set([
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'in',
]);

/** Parse the raw `include` / `include[]` query value into a validated set
 *  of IncludeRelation values.
 *
 *  Accepts Fastify's parsed shapes:
 *    - undefined / null → empty set
 *    - string           → split on comma, trim, validate each token
 *    - string[]         → validate each element
 *
 *  Unknown / invalid tokens are silently dropped. Case-sensitive.
 */
export function parseIncludes(raw: unknown): ParsedIncludes {
  const relations = new Set<IncludeRelation>();

  if (raw == null) return { relations };

  const tokens: string[] = [];
  if (typeof raw === 'string') {
    if (raw.trim().length === 0) return { relations };
    tokens.push(...raw.split(',').map((s) => s.trim()).filter(Boolean));
  } else if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') {
        tokens.push(...item.split(',').map((s) => s.trim()).filter(Boolean));
      }
    }
  } else {
    return { relations };
  }

  for (const token of tokens) {
    if (VALID_INCLUDES.has(token as IncludeRelation)) {
      relations.add(token as IncludeRelation);
    }
  }

  return { relations };
}

/** Parse the raw `filter` / `filter[]` query value into typed clauses.
 *
 *  Accepts Fastify's parsed shapes:
 *    - undefined / null → empty clauses
 *    - string           → one clause "field:operator:value"
 *    - string[]         → multiple clauses
 *    - Record<string, string> → object form: { field: "operator:value" }
 *
 *  Clause syntax:  field:operator:value
 *    - field    — entity column name (non-empty)
 *    - operator — one of FilterOperator
 *    - value    — operand (non-empty; may contain colons)
 *
 *  Malformed clauses are silently dropped.
 */
export function parseFilters(raw: unknown): ParsedFilters {
  const clauses: FilterClause[] = [];

  if (raw == null) return { clauses };

  const strings: string[] = [];

  if (typeof raw === 'string') {
    if (raw.trim().length > 0) strings.push(raw.trim());
  } else if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string' && item.trim().length > 0) {
        strings.push(item.trim());
      }
    }
  } else if (typeof raw === 'object' && raw !== null) {
    const record = raw as Record<string, unknown>;
    for (const [field, val] of Object.entries(record)) {
      if (typeof val === 'string' && val.trim().length > 0) {
        strings.push(`${field}:${val.trim()}`);
      }
    }
  }

  for (const rawClause of strings) {
    const clause = tryParseOneFilter(rawClause);
    if (clause != null) {
      clauses.push(clause);
    }
  }

  return { clauses };
}

function tryParseOneFilter(raw: string): FilterClause | null {
  const firstColon = raw.indexOf(':');
  if (firstColon < 1) return null;

  const field = raw.slice(0, firstColon).trim();
  if (field.length === 0) return null;

  const rest = raw.slice(firstColon + 1);
  const secondColon = rest.indexOf(':');
  if (secondColon < 0) return null;

  const operator = rest.slice(0, secondColon).trim();
  if (!VALID_OPERATORS.has(operator as FilterOperator)) return null;

  const value = rest.slice(secondColon + 1).trim();
  if (value.length === 0) return null;

  return {
    field,
    operator: operator as FilterOperator,
    value,
    raw,
  };
}

/** Parse the raw `page` and `per_page` query values into typed pagination.
 *
 *  * page defaults to 1; clamped to ≥ 1.
 *  * per_page defaults to 20; clamped to [1, MAX_PER_PAGE].
 *  * offset = (page - 1) * perPage.
 *  * limit  = perPage.
 */
export function parsePagination(params: {
  page?: unknown;
  per_page?: unknown;
}): ParsedPagination {
  const page = clampPage(parseNumber(params.page));
  const perPage = clampPerPage(parseNumber(params.per_page));

  return {
    page,
    perPage,
    offset: (page - 1) * perPage,
    limit: perPage,
  };
}

function parseNumber(raw: unknown): number {
  if (raw == null) return NaN;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  if (typeof raw === 'string') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

function clampPage(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.floor(n));
}

function clampPerPage(n: number): number {
  if (!Number.isFinite(n)) return 20;
  return Math.min(MAX_PER_PAGE, Math.max(1, Math.floor(n)));
}

/** Parse the combined query parameters into a single ParsedQuery.
 *
 *  This is the function the Fastify preHandler hook calls.
 */
export function parseQuery(params: {
  include?: unknown;
  filter?: unknown;
  page?: unknown;
  per_page?: unknown;
}): ParsedQuery {
  return {
    includes: parseIncludes(params.include),
    filters: parseFilters(params.filter),
    pagination: parsePagination({ page: params.page, per_page: params.per_page }),
  };
}
