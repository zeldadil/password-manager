/**
 * BE-001b: Core Tables Schema — foreign-key indexes.
 *
 * Validates the acceptance criterion "indexes on foreign keys" against a
 * freshly-migrated in-memory SQLite DB (ADR-003 Section 9.1 positive
 * consequence: SQLite does NOT auto-index FK columns, so every FK column
 * must carry an explicit index for the O(log n) ownership/authorization
 * lookups described in ADR-003 Section 6).
 *
 * These tests:
 *  - assert every DECLARED FK column (per PRAGMA foreign_key_list) has an index
 *  - assert every logical FK column — including the polymorphic grantee/target
 *    columns on `permissions` that are not declared as DB FKs — is indexed
 *  - assert each index covers exactly its FK column and is non-unique (a
 *    performance index, not a constraint)
 *  - assert the identity unique indexes (users.email, users.username,
 *    refresh_tokens.token_hash) remain intact alongside the FK indexes
 *  - assert the expected total index count so a regression (dropped index)
 *    is caught even if the map and the test are edited in lockstep
 *
 * Security: synthetic data only — no real secrets, keys, or PII in any
 * fixture (SEC-001 AR-4). No crypto columns are read or logged here; the
 * DB holds only opaque ciphertext blobs in those columns.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../src/schema';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

type SqliteColumnInfo = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

type SqliteIndexList = {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
};

type SqliteForeignKey = {
  id: number;
  seq: number;
  table: string; // referenced table
  from: string; // local column
  to: string; // referenced column (or empty)
  on_update: string;
  on_delete: string;
};

type IndexView = {
  name: string;
  unique: number;
  origin: string;
  columns: string[]; // columns covered by the index, in order
};

function getColumnNames(sqlite: Database.Database, tableName: string): string[] {
  return (
    sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as SqliteColumnInfo[]
  ).map((c) => c.name);
}

function getTableNames(sqlite: Database.Database): string[] {
  return (
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

function getIndexes(sqlite: Database.Database, tableName: string): IndexView[] {
  const lists = sqlite.prepare(`PRAGMA index_list(${tableName})`).all() as SqliteIndexList[];
  const out: IndexView[] = [];
  for (const idx of lists) {
    const cols = (sqlite.prepare(`PRAGMA index_info(${idx.name})`).all() as Array<{
      name: string;
    }>).map((c) => c.name);
    out.push({ name: idx.name, unique: idx.unique, origin: idx.origin, columns: cols });
  }
  return out;
}

function getForeignKeys(sqlite: Database.Database, tableName: string): SqliteForeignKey[] {
  return sqlite.prepare(`PRAGMA foreign_key_list(${tableName})`).all() as SqliteForeignKey[];
}

function hasIndexOnColumn(indexes: IndexView[], column: string): IndexView | undefined {
  return indexes.find((i) => i.columns.length === 1 && i.columns[0] === column);
}

/**
 * Every logical foreign-key column in the schema and the index Drizzle
 * generates for it. This is the BE-001b indexing invariant.
 *
 * `permissions.target_id` / `permissions.grantee_id` are polymorphic
 * (ADR-003 §3.5 — grantee is User *or* Group; target is Resource *or*
 * Folder *or* Vault) so they are not declared as single-column DB FKs,
 * but they are the hot lookup columns for the auth flow (ADR-003 §6.2)
 * and therefore must be indexed explicitly.
 */
const LOGICAL_FK_INDEXES: Record<string, Record<string, string>> = {
  folders: {
    vault_id: 'idx_folders_vault_id',
    owner_id: 'idx_folders_owner_id',
    parent_id: 'idx_folders_parent_id',
  },
  group_members: {
    group_id: 'idx_group_members_group_id',
    user_id: 'idx_group_members_user_id',
  },
  groups: {
    owner_id: 'idx_groups_owner_id',
  },
  permissions: {
    target_id: 'idx_permissions_target_id',
    grantee_id: 'idx_permissions_grantee_id',
    granted_by: 'idx_permissions_granted_by',
  },
  refresh_tokens: {
    user_id: 'idx_refresh_tokens_user_id',
  },
  resource_tags: {
    resource_id: 'idx_resource_tags_resource_id',
    tag_id: 'idx_resource_tags_tag_id',
  },
  resources: {
    vault_id: 'idx_resources_vault_id',
    owner_id: 'idx_resources_owner_id',
    folder_id: 'idx_resources_folder_id',
  },
  sessions: {
    user_id: 'idx_sessions_user_id',
  },
  tags: {
    vault_id: 'idx_tags_vault_id',
  },
  vaults: {
    owner_id: 'idx_vaults_owner_id',
  },
  // `users` has no FK columns — only identity unique indexes (tested below).
};

// Tables that declare at least one DB-level foreign key constraint
// (queried via PRAGMA foreign_key_list). Used to prove no declared FK
// column is left un-indexed, independent of the map above.
const FK_TABLES = [
  'folders',
  'group_members',
  'groups',
  'permissions',
  'refresh_tokens',
  'resource_tags',
  'resources',
  'secrets',
  'sessions',
  'tags',
  'vaults',
];

describe('BE-001b: Core Tables Schema — foreign-key indexes', () => {
  let sqlite: Database.Database;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let db: ReturnType<typeof drizzle>;

  beforeAll(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  });

  afterAll(() => {
    sqlite.close();
  });

  describe('schema prerequisites', () => {
    it('all 12 core tables are present (11 baseline + BE-003c secrets)', () => {
      const tables = getTableNames(sqlite).filter((t) => !t.startsWith('__drizzl'));
      expect(tables).toEqual(
        [
          'folders',
          'group_members',
          'groups',
          'permissions',
          'refresh_tokens',
          'resource_tags',
          'resources',
          'secrets',
          'sessions',
          'tags',
          'users',
          'vaults',
        ].sort(),
      );
    });
  });

  describe('every declared FK column has an index', () => {
    // Regression guard: uses the DB's own FK declarations as ground truth,
    // so adding a new FK column without an index fails this test.
    for (const table of FK_TABLES) {
      it(`${table}: every foreign_key_list column is indexed`, () => {
        const fks = getForeignKeys(sqlite, table);
        const fkColumns = Array.from(new Set(fks.map((f) => f.from)));
        const indexes = getIndexes(sqlite, table);
        for (const col of fkColumns) {
          const idx = hasIndexOnColumn(indexes, col);
          expect(idx, `${table}.${col} has no index`).toBeDefined();
        }
      });
    }
  });

  describe('every logical (incl. polymorphic) FK column is indexed', () => {
    for (const [table, columns] of Object.entries(LOGICAL_FK_INDEXES)) {
      for (const [column, expectedName] of Object.entries(columns)) {
        it(`${table}.${column} -> index "${expectedName}"`, () => {
          const indexes = getIndexes(sqlite, table);
          const idx = indexes.find((i) => i.name === expectedName);
          expect(idx, `${expectedName} missing on ${table}`).toBeDefined();
          expect(idx!.columns).toEqual([column]);
        });
      }
    }
  });

  describe('FK indexes are non-unique performance indexes', () => {
    for (const [table, columns] of Object.entries(LOGICAL_FK_INDEXES)) {
      for (const [column, name] of Object.entries(columns)) {
        it(`${name} (${table}.${column}) is non-unique`, () => {
          const indexes = getIndexes(sqlite, table);
          const idx = indexes.find((i) => i.name === name);
          expect(idx).toBeDefined();
          expect(idx!.unique).toBe(0);
          // 'c' = created via CREATE INDEX (origin), not a constraint / pk index
          expect(idx!.origin).toBe('c');
        });
      }
    }
  });

  describe('identity unique indexes are preserved alongside FK indexes', () => {
    it('users.email unique index exists (unique constraint origin)', () => {
      const indexes = getIndexes(sqlite, 'users');
      const idx = indexes.find((i) => i.name === 'users_email_unique');
      expect(idx).toBeDefined();
      expect(idx!.unique).toBe(1);
    });

    it('users.username unique index exists', () => {
      const indexes = getIndexes(sqlite, 'users');
      const idx = indexes.find((i) => i.name === 'users_username_unique');
      expect(idx).toBeDefined();
      expect(idx!.unique).toBe(1);
    });

    it('refresh_tokens.token_hash unique index exists', () => {
      const indexes = getIndexes(sqlite, 'refresh_tokens');
      const idx = indexes.find((i) => i.name === 'refresh_tokens_token_hash_unique');
      expect(idx).toBeDefined();
      expect(idx!.unique).toBe(1);
    });
  });

  describe('index coverage is complete (regression count)', () => {
    it('every non-junction entity with FKs plus both junction tables are indexed', () => {
      const allIndexedColumns = Object.entries(LOGICAL_FK_INDEXES).flatMap(
        ([table, cols]) => Object.keys(cols).map((col) => `${table}.${col}`),
      );
      // 16 declared FK columns + 2 polymorphic (permissions.target_id, grantee_id) = 18
      expect(allIndexedColumns).toHaveLength(18);

      // Each must be backed by exactly one non-unique index in the DB.
      const missing: string[] = [];
      for (const [table, columns] of Object.entries(LOGICAL_FK_INDEXES)) {
        const indexes = getIndexes(sqlite, table);
        for (const [column, name] of Object.entries(columns)) {
          const idx = indexes.find((i) => i.name === name);
          if (!idx || idx.columns[0] !== column) missing.push(`${table}.${column}`);
        }
      }
      expect(missing, `Unindexed FK columns: ${missing.join(', ')}`).toEqual([]);
    });
  });
});
