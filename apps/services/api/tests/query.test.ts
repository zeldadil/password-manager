/** @license
 * BE-001e: Query middleware unit tests.
 *
 * Covers pure parsing functions (parseIncludes, parseFilters,
 * parsePagination, parseQuery) — the core of BE-001e.
 *
 * Acceptance criteria:
 *  1. include[] parser for eager loading (permissions, tags, folder, group)
 *  2. filter[] and pagination (page, per_page) middleware
 *
 * Test type: unit (per task spec). No DB, no HTTP — pure function tests.
 */

import { describe, expect, it } from 'vitest';
import type { FilterClause, IncludeRelation } from '../src/middleware/query-parse';
import {
  parseIncludes,
  parseFilters,
  parsePagination,
  parseQuery,
} from '../src/middleware/query-parse';

/* ═══════════════════════════════════════════════════════════════════════
 *  parseIncludes — eager-loading relation parser
 * ═══════════════════════════════════════════════════════════════════════ */

describe('parseIncludes', () => {
  it('returns an empty set when raw is undefined', () => {
    expect(parseIncludes(undefined).relations.size).toBe(0);
  });

  it('returns an empty set when raw is null', () => {
    expect(parseIncludes(null).relations.size).toBe(0);
  });

  it('returns an empty set when raw is an empty string', () => {
    expect(parseIncludes('').relations.size).toBe(0);
  });

  it('returns an empty set when raw is an empty array', () => {
    expect(parseIncludes([]).relations.size).toBe(0);
  });

  it('parses a single include value', () => {
    const result = parseIncludes('permissions');
    expect(result.relations.has('permissions')).toBe(true);
    expect(result.relations.size).toBe(1);
  });

  it('parses a comma-separated include string', () => {
    const result = parseIncludes('permissions,tags,folder');
    expect(result.relations.has('permissions')).toBe(true);
    expect(result.relations.has('tags')).toBe(true);
    expect(result.relations.has('folder')).toBe(true);
    expect(result.relations.size).toBe(3);
  });

  it('parses an array of include values (Fastify include[] form)', () => {
    const result = parseIncludes(['permissions', 'tags', 'group']);
    expect(result.relations.has('permissions')).toBe(true);
    expect(result.relations.has('tags')).toBe(true);
    expect(result.relations.has('group')).toBe(true);
    expect(result.relations.has('folder')).toBe(false);
    expect(result.relations.size).toBe(3);
  });

  it('de-duplicates values within a comma-separated string', () => {
    const result = parseIncludes('permissions,permissions,tags');
    expect(result.relations.has('permissions')).toBe(true);
    expect(result.relations.has('tags')).toBe(true);
    expect(result.relations.size).toBe(2);
  });

  it('de-duplicates values across array entries', () => {
    const result = parseIncludes(['permissions', 'tags', 'permissions']);
    expect(result.relations.has('permissions')).toBe(true);
    expect(result.relations.has('tags')).toBe(true);
    expect(result.relations.size).toBe(2);
  });

  it('strips whitespace around comma-separated values', () => {
    const result = parseIncludes(' permissions , tags , folder ');
    expect(result.relations.has('permissions')).toBe(true);
    expect(result.relations.has('tags')).toBe(true);
    expect(result.relations.has('folder')).toBe(true);
    expect(result.relations.size).toBe(3);
  });

  it('drops unknown include values silently', () => {
    const result = parseIncludes('permissions,unknownvalue,tags,nope');
    expect(result.relations.has('permissions')).toBe(true);
    expect(result.relations.has('tags')).toBe(true);
    expect(result.relations.has('unknownvalue' as IncludeRelation)).toBe(false);
    expect(result.relations.has('nope' as IncludeRelation)).toBe(false);
    expect(result.relations.size).toBe(2);
  });

  it('handles mixed array with unknown values', () => {
    const result = parseIncludes(['permissions', 'bogus', 'group', 'fake']);
    expect(result.relations.has('permissions')).toBe(true);
    expect(result.relations.has('group')).toBe(true);
    expect(result.relations.size).toBe(2);
  });

  it('handles an array containing empty strings', () => {
    const result = parseIncludes(['permissions', '', 'tags', '   ']);
    expect(result.relations.has('permissions')).toBe(true);
    expect(result.relations.has('tags')).toBe(true);
    expect(result.relations.size).toBe(2);
  });

  it('returns an empty set for a non-string, non-array primitive', () => {
    expect(parseIncludes(42).relations.size).toBe(0);
    expect(parseIncludes(true).relations.size).toBe(0);
    expect(parseIncludes({}).relations.size).toBe(0);
  });

  it('validates all four allowed relations are accepted', () => {
    const result = parseIncludes(['permissions', 'tags', 'folder', 'group']);
    expect(result.relations.has('permissions')).toBe(true);
    expect(result.relations.has('tags')).toBe(true);
    expect(result.relations.has('folder')).toBe(true);
    expect(result.relations.has('group')).toBe(true);
    expect(result.relations.size).toBe(4);
  });

  it('accepts mixed-case — but rejects wrong-case values', () => {
    // Values are case-sensitive: "Permissions" != "permissions".
    const result = parseIncludes('Permissions,tags');
    expect(result.relations.has('tags')).toBe(true);
    expect(result.relations.has('Permissions' as IncludeRelation)).toBe(false);
    expect(result.relations.size).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 *  parseFilters — filter clause parser
 * ═══════════════════════════════════════════════════════════════════════ */

describe('parseFilters', () => {
  it('returns an empty clause list when raw is undefined', () => {
    expect(parseFilters(undefined).clauses).toHaveLength(0);
  });

  it('returns an empty clause list when raw is null', () => {
    expect(parseFilters(null).clauses).toHaveLength(0);
  });

  it('returns an empty clause list when raw is an empty string', () => {
    expect(parseFilters('').clauses).toHaveLength(0);
  });

  it('parses a single filter clause in field:operator:value form', () => {
    const result = parseFilters('name:contains:Servers');
    expect(result.clauses).toHaveLength(1);
    expect(result.clauses[0].field).toBe('name');
    expect(result.clauses[0].operator).toBe('contains');
    expect(result.clauses[0].value).toBe('Servers');
    expect(result.clauses[0].raw).toBe('name:contains:Servers');
  });

  it('parses all eight supported operators', () => {
    const cases = [
      ['type:eq:server', 'type', 'eq' as const, 'server'],
      ['count:ne:0', 'count', 'ne' as const, '0'],
      ['priority:gt:5', 'priority', 'gt' as const, '5'],
      ['priority:gte:5', 'priority', 'gte' as const, '5'],
      ['priority:lt:5', 'priority', 'lt' as const, '5'],
      ['priority:lte:5', 'priority', 'lte' as const, '5'],
      ['name:contains:Admin', 'name', 'contains' as const, 'Admin'],
      ['status:in:active,inactive', 'status', 'in' as const, 'active,inactive'],
    ];
    for (const [raw, expectedField, expectedOp, expectedValue] of cases) {
      const result = parseFilters(raw);
      expect(result.clauses).toHaveLength(1);
      expect(result.clauses[0].field).toBe(expectedField);
      expect(result.clauses[0].operator).toBe(expectedOp);
      expect(result.clauses[0].value).toBe(expectedValue);
    }
  });

  it('preserves colons in the value (e.g. ISO timestamps)', () => {
    const result = parseFilters('created_at:gte:2026-01-01T00:00:00Z');
    expect(result.clauses).toHaveLength(1);
    expect(result.clauses[0].field).toBe('created_at');
    expect(result.clauses[0].operator).toBe('gte');
    expect(result.clauses[0].value).toBe('2026-01-01T00:00:00Z');
  });

  it('parses an array of filter clauses (Fastify filter[] form)', () => {
    const result = parseFilters([
      'name:contains:Prod',
      'type:eq:server',
      'created_at:gte:2026-01-01T00:00:00Z',
    ]);
    expect(result.clauses).toHaveLength(3);
    expect(result.clauses[0].field).toBe('name');
    expect(result.clauses[0].operator).toBe('contains');
    expect(result.clauses[0].value).toBe('Prod');
    expect(result.clauses[1].field).toBe('type');
    expect(result.clauses[1].operator).toBe('eq');
    expect(result.clauses[1].value).toBe('server');
    expect(result.clauses[2].field).toBe('created_at');
    expect(result.clauses[2].operator).toBe('gte');
    expect(result.clauses[2].value).toBe('2026-01-01T00:00:00Z');
  });

  it('drops malformed clauses (no colon) silently', () => {
    const result = parseFilters(['name:containers', 'type:eq:server']);
    expect(result.clauses).toHaveLength(1);
    expect(result.clauses[0].field).toBe('type');
  });

  it('drops malformed clauses (unknown operator) silently', () => {
    const result = parseFilters(['name:like:Admin', 'type:eq:server']);
    expect(result.clauses).toHaveLength(1);
    expect(result.clauses[0].field).toBe('type');
  });

  it('drops malformed clauses (empty field) silently', () => {
    const result = parseFilters([':contains:Admin', 'type:eq:server']);
    expect(result.clauses).toHaveLength(1);
    expect(result.clauses[0].field).toBe('type');
  });

  it('drops malformed clauses (empty value) silently', () => {
    const result = parseFilters(['name:contains:', 'type:eq:server']);
    expect(result.clauses).toHaveLength(1);
    expect(result.clauses[0].field).toBe('type');
  });

  it('drops malformed clauses (operators with no value) silently', () => {
    const result = parseFilters(['type:eq:', 'name:contains:Admin']);
    expect(result.clauses).toHaveLength(1);
    expect(result.clauses[0].field).toBe('name');
    expect(result.clauses[0].operator).toBe('contains');
    expect(result.clauses[0].value).toBe('Admin');
  });

  it('drops clauses with field starting with colon', () => {
    const result = parseFilters([':bad:val', 'good:eq:right']);
    expect(result.clauses).toHaveLength(1);
    expect(result.clauses[0].field).toBe('good');
  });

  it('handles mixed valid and invalid clauses', () => {
    const result = parseFilters([
      'valid:eq:ok',
      'nope',
      'also:bad',
      'field:invalidop:x',
      'good:gt:5',
    ]);
    expect(result.clauses).toHaveLength(2);
    expect(result.clauses[0].field).toBe('valid');
    expect(result.clauses[0].operator).toBe('eq');
    expect(result.clauses[1].field).toBe('good');
    expect(result.clauses[1].operator).toBe('gt');
  });

  it('handles the object form (filter[field]=value)', () => {
    // Fastify may parse ?filter[name]=contains:Servers into an object.
    const result = parseFilters({ name: 'contains:Servers', type: 'eq:server' });
    expect(result.clauses).toHaveLength(2);
    expect(result.clauses[0].field).toBe('name');
    expect(result.clauses[0].operator).toBe('contains');
    expect(result.clauses[0].value).toBe('Servers');
    expect(result.clauses[1].field).toBe('type');
    expect(result.clauses[1].operator).toBe('eq');
    expect(result.clauses[1].value).toBe('server');
  });

  it('handles the object form with non-string values (drops them)', () => {
    const result = parseFilters({ name: 'contains:Valid', bad: 42, empty: '' });
    expect(result.clauses).toHaveLength(1);
    expect(result.clauses[0].field).toBe('name');
    expect(result.clauses[0].operator).toBe('contains');
    expect(result.clauses[0].value).toBe('Valid');
  });

  it('returns clauses in the order they were supplied', () => {
    const result = parseFilters(['c:eq:3', 'a:eq:1', 'b:eq:2']);
    expect(result.clauses.map((c: FilterClause) => c.field)).toEqual(['c', 'a', 'b']);
  });

  it('trims whitespace from each clause component', () => {
    const result = parseFilters('  name  :  contains  :  Servers  ');
    expect(result.clauses).toHaveLength(1);
    expect(result.clauses[0].field).toBe('name');
    expect(result.clauses[0].operator).toBe('contains');
    expect(result.clauses[0].value).toBe('Servers');
  });

  it('handles arrays containing empty/whitespace strings', () => {
    const result = parseFilters(['name:eq:ok', '', '   ', 'type:eq:server']);
    expect(result.clauses).toHaveLength(2);
  });

  it('drops entries in object form where value has no colon', () => {
    const result = parseFilters({ name: 'justastring' });
    expect(result.clauses).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 *  parsePagination — page / per_page parser
 * ═══════════════════════════════════════════════════════════════════════ */

describe('parsePagination', () => {
  it('returns defaults when no params are supplied', () => {
    const result = parsePagination({});
    expect(result.page).toBe(1);
    expect(result.perPage).toBe(20);
    expect(result.offset).toBe(0);
    expect(result.limit).toBe(20);
  });

  it('parses page=1', () => {
    const result = parsePagination({ page: '1' });
    expect(result.page).toBe(1);
    expect(result.offset).toBe(0);
  });

  it('parses page=5', () => {
    const result = parsePagination({ page: '5' });
    expect(result.page).toBe(5);
    expect(result.offset).toBe(4 * 20); // 80 with default perPage
    expect(result.limit).toBe(20);
  });

  it('parses per_page=50', () => {
    const result = parsePagination({ per_page: '50' });
    expect(result.perPage).toBe(50);
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
  });

  it('parses both page and per_page together', () => {
    const result = parsePagination({ page: '3', per_page: '10' });
    expect(result.page).toBe(3);
    expect(result.perPage).toBe(10);
    expect(result.offset).toBe(20); // (3-1)*10
    expect(result.limit).toBe(10);
  });

  it('clamps page below 1 to 1', () => {
    expect(parsePagination({ page: '0' }).page).toBe(1);
    expect(parsePagination({ page: '-5' }).page).toBe(1);
  });

  it('clamps per_page above MAX_PER_PAGE to MAX_PER_PAGE', () => {
    const result = parsePagination({ per_page: '9999' });
    expect(result.perPage).toBe(100);
    expect(result.limit).toBe(100);
  });

  it('clamps per_page below 1 to 1', () => {
    expect(parsePagination({ per_page: '0' }).perPage).toBe(1);
    expect(parsePagination({ per_page: '-10' }).perPage).toBe(1);
  });

  it('falls back to defaults for non-numeric page', () => {
    expect(parsePagination({ page: 'abc' }).page).toBe(1);
    expect(parsePagination({ page: undefined }).page).toBe(1);
  });

  it('falls back to defaults for non-numeric per_page', () => {
    expect(parsePagination({ per_page: 'abc' }).perPage).toBe(20);
    expect(parsePagination({ per_page: undefined }).perPage).toBe(20);
  });

  it('handles numeric (not string) inputs', () => {
    const result = parsePagination({ page: 3, per_page: 15 });
    expect(result.page).toBe(3);
    expect(result.perPage).toBe(15);
    expect(result.offset).toBe(30);
  });

  it('floors fractional page values', () => {
    expect(parsePagination({ page: '2.9' }).page).toBe(2);
  });

  it('floors fractional per_page values', () => {
    expect(parsePagination({ per_page: '19.9' }).perPage).toBe(19);
  });

  it('computes offset correctly for high page numbers', () => {
    const result = parsePagination({ page: '100', per_page: '50' });
    expect(result.page).toBe(100);
    expect(result.offset).toBe(99 * 50); // 4950
    expect(result.limit).toBe(50);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 *  parseQuery — combined entry point
 * ═══════════════════════════════════════════════════════════════════════ */

describe('parseQuery', () => {
  it('returns defaults for empty params', () => {
    const result = parseQuery({});
    expect(result.includes.relations.size).toBe(0);
    expect(result.filters.clauses).toHaveLength(0);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.perPage).toBe(20);
    expect(result.pagination.offset).toBe(0);
    expect(result.pagination.limit).toBe(20);
  });

  it('combines include, filter, and pagination', () => {
    const result = parseQuery({
      include: 'permissions,tags',
      filter: ['name:contains:Prod', 'type:eq:server'],
      page: '2',
      per_page: '25',
    });
    expect(result.includes.relations.has('permissions')).toBe(true);
    expect(result.includes.relations.has('tags')).toBe(true);
    expect(result.includes.relations.size).toBe(2);
    expect(result.filters.clauses).toHaveLength(2);
    expect(result.filters.clauses[0].field).toBe('name');
    expect(result.filters.clauses[1].field).toBe('type');
    expect(result.pagination.page).toBe(2);
    expect(result.pagination.perPage).toBe(25);
    expect(result.pagination.offset).toBe(25);
    expect(result.pagination.limit).toBe(25);
  });

  it('handles the filter object form together with include', () => {
    const result = parseQuery({
      include: ['folder', 'group'],
      filter: { name: 'contains:Admin', type: 'eq:login' },
      page: '1',
      per_page: '50',
    });
    expect(result.includes.relations.has('folder')).toBe(true);
    expect(result.includes.relations.has('group')).toBe(true);
    expect(result.includes.relations.size).toBe(2);
    expect(result.filters.clauses).toHaveLength(2);
    expect(result.filters.clauses[0].field).toBe('name');
    expect(result.filters.clauses[1].field).toBe('type');
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.perPage).toBe(50);
    expect(result.pagination.offset).toBe(0);
  });

  it('gracefully ignores unknown top-level params', () => {
    // parseQuery only reads include/filter/page/per_page; extra keys are
    // ignored by design (the function destructures what it needs).
    const params: Record<string, unknown> = {
      include: 'tags',
      filter: 'type:eq:server',
      page: '1',
      per_page: '10',
      sort: 'name',           // unknown — should be ignored
      fields: 'id,name',      // unknown — should be ignored
    };
    const result = parseQuery(params);
    expect(result.includes.relations.has('tags')).toBe(true);
    expect(result.filters.clauses).toHaveLength(1);
    expect(result.pagination.perPage).toBe(10);
  });

  it('reads page/per_page from params with underscores (per_page)', () => {
    const result = parseQuery({ page: '3', per_page: '15' });
    expect(result.pagination.page).toBe(3);
    expect(result.pagination.perPage).toBe(15);
    expect(result.pagination.offset).toBe(30);
  });

  it('caps per_page at MAX_PER_PAGE (100) in the combined form', () => {
    const result = parseQuery({ per_page: '9999' });
    expect(result.pagination.perPage).toBe(100);
    expect(result.pagination.limit).toBe(100);
  });

  it('clamps page to 1 when given 0 in the combined form', () => {
    const result = parseQuery({ page: '0' });
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.offset).toBe(0);
  });

  it('handles all four include values plus multiple filters plus pagination', () => {
    const result = parseQuery({
      include: 'permissions,tags,folder,group',
      filter: [
        'name:contains:Prod',
        'type:eq:server',
        'created_at:gte:2026-01-01T00:00:00Z',
      ],
      page: '5',
      per_page: '25',
    });
    expect(result.includes.relations.size).toBe(4);
    expect(result.filters.clauses).toHaveLength(3);
    expect(result.pagination.page).toBe(5);
    expect(result.pagination.perPage).toBe(25);
    expect(result.pagination.offset).toBe(100); // (5-1)*25
    expect(result.pagination.limit).toBe(25);
  });
});
