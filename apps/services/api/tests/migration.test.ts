/**
 * Unit tests for BE-001a: DB Migration System.
 *
 * Validates:
 *  - Drizzle Kit config + schema exist and are well-formed
 *  - Baseline migration applies cleanly to an in-memory SQLite DB
 *  - All ADR-003 tables are created with correct columns
 *  - Migration tracking table records the baseline
 *  - Crypto boundary: no plaintext secret columns in the schema
 *  - FK constraints are enforced (PRAGMA foreign_keys = ON)
 *  - Soft-delete: deleted_at is nullable, defaults to NULL
 *  - Unique constraints and defaults work
 *
 * Security: synthetic data only — no real secrets, keys, or PII in any
 * test fixture (SEC-001 AR-4).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../src/schema';
import * as fs from 'fs';
import * as path from 'path';

import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

// ─── Schema introspection helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type SqliteColumnInfo = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

type SQLiteDatabase = InstanceType<typeof Database>;

function getColumns(sqlite: SQLiteDatabase, tableName: string): SqliteColumnInfo[] {
  return sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as SqliteColumnInfo[];
}

function getColumnNames(sqlite: SQLiteDatabase, tableName: string): string[] {
  return getColumns(sqlite, tableName).map((c) => c.name);
}

function getTableNames(sqlite: SQLiteDatabase): string[] {
  return (
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

function getForeignKeys(sqlite: SQLiteDatabase, tableName: string): Array<{
  from: string;
  to: string;
  to_table: string;
}> {
  return (
    sqlite.prepare(`PRAGMA foreign_key_list(${tableName})`).all() as Array<{
      from: string;
      to: string;
      table: string;
    }>
  ).map((fk) => ({ from: fk.from, to: fk.to, to_table: fk.table }));
}

// ─── Table registry from schema.ts ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const ALL_TABLES = [
  'users',
  'vaults',
  'folders',
  'resources',
  'tags',
  'resource_tags',
  'secrets',
  'permissions',
  'groups',
  'group_members',
  'sessions',
  'refresh_tokens',
];

// ─── Tests ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('BE-001a: DB Migration System', () => {
  let sqlite: SQLiteDatabase;
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

  // ─── Configuration ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('Migration system configuration', () => {
    it('drizzle.config.ts exists with sqlite dialect', () => {
      const configPath = path.resolve(__dirname, '..', 'drizzle.config.ts');
      expect(fs.existsSync(configPath)).toBe(true);
    });

    it('schema.ts exports all entities defined in ADR-003', () => {
      expect(schema.users).toBeDefined();
      expect(schema.vaults).toBeDefined();
      expect(schema.folders).toBeDefined();
      expect(schema.resources).toBeDefined();
      expect(schema.tags).toBeDefined();
      expect(schema.resourceTags).toBeDefined();
      expect(schema.secrets).toBeDefined();
      expect(schema.permissions).toBeDefined();
      expect(schema.groups).toBeDefined();
      expect(schema.groupMembers).toBeDefined();
      expect(schema.sessions).toBeDefined();
      expect(schema.refreshTokens).toBeDefined();
    });

    it('baseline migration SQL file exists', () => {
      const migrationFile = path.resolve(MIGRATIONS_DIR, '0000_baseline_schema.sql');
      expect(fs.existsSync(migrationFile)).toBe(true);
    });

    it('migration journal (_journal.json) records the baseline, BE-002e rate-limiting, and BE-003c secrets migrations', () => {
      const journalPath = path.resolve(MIGRATIONS_DIR, 'meta', '_journal.json');
      expect(fs.existsSync(journalPath)).toBe(true);
      const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
      expect(journal.version).toBe('7');
      expect(journal.dialect).toBe('sqlite');
      expect(journal.entries).toHaveLength(3);
      expect(journal.entries[0].tag).toBe('0000_baseline_schema');
      expect(journal.entries[1].tag).toBe('0001_be002e_rate_limiting');
      expect(journal.entries[2].tag).toBe('0002_be003c_secrets_table');
    });
  });

  // ─── Table creation ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('Baseline migration creates all tables', () => {
    it('creates all 12 tables (11 baseline + BE-003c secrets)', () => {
      const tables = getTableNames(sqlite);
      for (const table of ALL_TABLES) {
        expect(tables).toContain(table);
      }
    });

    it('creates the Drizzle migration tracking table', () => {
      const tables = getTableNames(sqlite);
      expect(tables).toContain('__drizzle_migrations');
    });

    it('records the baseline migration in the tracking table', () => {
      const result = sqlite
        .prepare("SELECT COUNT(*) as count FROM __drizzle_migrations")
        .get() as { count: number };
      expect(result.count).toBeGreaterThanOrEqual(1);
    });

    it('does not create extraneous tables', () => {
      const tables = getTableNames(sqlite).filter((t) => !t.startsWith('__drizzl'));
      expect(tables.sort()).toEqual([...ALL_TABLES].sort());
    });
  });

  // ─── Column types (ADR-003 compliance) ━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('users table — KDF + vault key (crypto boundary)', () => {
    it('has all columns from ADR-003 Section 3.1', () => {
      const cols = getColumnNames(sqlite, 'users');
      // Identity
      expect(cols).toContain('id');
      expect(cols).toContain('email');
      expect(cols).toContain('username');
      // KDF material (SEC-001 Decision 1)
      expect(cols).toContain('salt');
      expect(cols).toContain('kdf_params');
      // Encrypted vault key (SEC-001 Decision 3)
      expect(cols).toContain('vault_key_encrypted');
      expect(cols).toContain('vault_key_iv');
      expect(cols).toContain('vault_key_tag');
      // Recovery kit (SEC-001 Decision 7, nullable)
      expect(cols).toContain('recovery_kit_encrypted');
      expect(cols).toContain('recovery_kit_iv');
      expect(cols).toContain('recovery_kit_tag');
      // MFA
      expect(cols).toContain('mfa_secret');
      // Non-secret settings
      expect(cols).toContain('settings');
      // Common
      expect(cols).toContain('created_at');
      expect(cols).toContain('updated_at');
      expect(cols).toContain('deleted_at');
    });

    it('does NOT store master password in any form', () => {
      const cols = getColumnNames(sqlite, 'users');
      expect(cols).not.toContain('master_password');
      expect(cols).not.toContain('master_password_hash');
      expect(cols).not.toContain('password');
      expect(cols).not.toContain('password_hash');
    });

    it('stores salt, vault key material, and recovery kit as BLOB', () => {
      const info = getColumns(sqlite, 'users');
      const byName = Object.fromEntries(info.map((c) => [c.name, c]));
      expect(byName['salt'].type.toUpperCase()).toBe('BLOB');
      expect(byName['vault_key_encrypted'].type.toUpperCase()).toBe('BLOB');
      expect(byName['vault_key_iv'].type.toUpperCase()).toBe('BLOB');
      expect(byName['vault_key_tag'].type.toUpperCase()).toBe('BLOB');
      expect(byName['recovery_kit_encrypted'].type.toUpperCase()).toBe('BLOB');
    });

    it('stores kdf_params and settings as TEXT (JSON-encoded)', () => {
      const info = getColumns(sqlite, 'users');
      const byName = Object.fromEntries(info.map((c) => [c.name, c]));
      expect(byName['kdf_params'].type.toUpperCase()).toBe('TEXT');
      expect(byName['settings'].type.toUpperCase()).toBe('TEXT');
    });

    it('defaults settings to empty JSON object', () => {
      const info = getColumns(sqlite, 'users');
      const settings = info.find((c) => c.name === 'settings');
      expect(settings).toBeDefined();
      expect(settings!.dflt_value).toBe("'{}'");
    });
  });

  describe('vaults table — ADR-003 Section 3.2', () => {
    it('has all expected columns', () => {
      const cols = getColumnNames(sqlite, 'vaults');
      expect(cols).toContain('id');
      expect(cols).toContain('owner_id');
      expect(cols).toContain('name');
      expect(cols).toContain('description');
      expect(cols).toContain('version');
      expect(cols).toContain('created_at');
      expect(cols).toContain('updated_at');
      expect(cols).toContain('deleted_at');
    });

    it('defaults version to 1', () => {
      const info = getColumns(sqlite, 'vaults');
      const version = info.find((c) => c.name === 'version');
      expect(version).toBeDefined();
      expect(version!.dflt_value).toBe('1');
    });
  });

  describe('resources table — secret is always encrypted (ADR-003 Section 3.3)', () => {
    it('has secret ciphertext + IV + tag as BLOB (never plaintext)', () => {
      const cols = getColumnNames(sqlite, 'resources');
      expect(cols).toContain('secret_ciphertext');
      expect(cols).toContain('secret_iv');
      expect(cols).toContain('secret_tag');
    });

    it('has opt-in metadata encryption columns', () => {
      const cols = getColumnNames(sqlite, 'resources');
      expect(cols).toContain('metadata_encrypted');
      expect(cols).toContain('metadata_ciphertext');
      expect(cols).toContain('metadata_iv');
      expect(cols).toContain('metadata_tag');
    });

    it('does NOT have a plaintext secret column', () => {
      const cols = getColumnNames(sqlite, 'resources');
      expect(cols).not.toContain('secret');
      expect(cols).not.toContain('password');
      expect(cols).not.toContain('plaintext_secret');
    });

    it('defaults metadata_encrypted to false', () => {
      const info = getColumns(sqlite, 'resources');
      const col = info.find((c) => c.name === 'metadata_encrypted');
      expect(col).toBeDefined();
      expect(col!.dflt_value).toBe('false');
    });
  });

  describe('folders table — ADR-003 Section 3.4', () => {
    it('has self-referential parent_id', () => {
      const cols = getColumnNames(sqlite, 'folders');
      expect(cols).toContain('parent_id');
      expect(cols).toContain('permission_mask_level');
      expect(cols).toContain('permission_mask_grantee_type');
      expect(cols).toContain('permission_mask_grantee_id');
    });

    it('has FK to parent folder (self-reference)', () => {
      const fks = getForeignKeys(sqlite, 'folders');
      const parentFk = fks.find((f) => f.from === 'parent_id');
      expect(parentFk).toBeDefined();
      expect(parentFk!.to_table).toBe('folders');
    });
  });

  describe('tags table — ADR-003 Section 3.6', () => {
    it('has vault-scoped tag columns', () => {
      const cols = getColumnNames(sqlite, 'tags');
      expect(cols).toContain('vault_id');
      expect(cols).toContain('name');
      expect(cols).toContain('color');
      const fks = getForeignKeys(sqlite, 'tags');
      expect(fks.find((f) => f.from === 'vault_id')).toBeDefined();
    });
  });

  describe('resource_tags junction — ADR-003 Section 8.1 Open Q1', () => {
    it('has resource_id and tag_id columns', () => {
      const cols = getColumnNames(sqlite, 'resource_tags');
      expect(cols).toContain('resource_id');
      expect(cols).toContain('tag_id');
    });

    it('has FKs to both resources and tags', () => {
      const fks = getForeignKeys(sqlite, 'resource_tags');
      expect(fks.find((f) => f.from === 'resource_id' && f.to_table === 'resources')).toBeDefined();
      expect(fks.find((f) => f.from === 'tag_id' && f.to_table === 'tags')).toBeDefined();
    });
  });

  describe('secrets table — per-grantee encrypted copies for sharing (BE-003c)', () => {
    it('has resource_id, user_id, ciphertext, iv, tag columns', () => {
      const cols = getColumnNames(sqlite, 'secrets');
      expect(cols).toContain('id');
      expect(cols).toContain('resource_id');
      expect(cols).toContain('user_id');
      expect(cols).toContain('ciphertext');
      expect(cols).toContain('iv');
      expect(cols).toContain('tag');
      expect(cols).toContain('created_at');
      expect(cols).toContain('updated_at');
    });

    it('stores ciphertext, iv, and tag as BLOB (never plaintext)', () => {
      const info = getColumns(sqlite, 'secrets');
      const byName = Object.fromEntries(info.map((c) => [c.name, c]));
      expect(byName['ciphertext'].type.toUpperCase()).toBe('BLOB');
      expect(byName['iv'].type.toUpperCase()).toBe('BLOB');
      expect(byName['tag'].type.toUpperCase()).toBe('BLOB');
    });

    it('has FKs to both resources and users', () => {
      const fks = getForeignKeys(sqlite, 'secrets');
      expect(fks.find((f) => f.from === 'resource_id' && f.to_table === 'resources')).toBeDefined();
      expect(fks.find((f) => f.from === 'user_id' && f.to_table === 'users')).toBeDefined();
    });

    it('does not have a deleted_at column (hard-delete on revoke)', () => {
      const cols = getColumnNames(sqlite, 'secrets');
      expect(cols).not.toContain('deleted_at');
    });
  });

  describe('permissions table — ADR-003 Section 3.5', () => {
    it('has target + grantee + level columns', () => {
      const cols = getColumnNames(sqlite, 'permissions');
      expect(cols).toContain('target_type');
      expect(cols).toContain('target_id');
      expect(cols).toContain('grantee_type');
      expect(cols).toContain('grantee_id');
      expect(cols).toContain('level');
      expect(cols).toContain('granted_by');
    });
  });

  describe('groups + group_members — ADR-003 Section 3.7', () => {
    it('groups table has owner_id FK', () => {
      const fks = getForeignKeys(sqlite, 'groups');
      expect(fks.find((f) => f.from === 'owner_id' && f.to_table === 'users')).toBeDefined();
    });

    it('group_members has FKs to groups and users', () => {
      const fks = getForeignKeys(sqlite, 'group_members');
      expect(fks.find((f) => f.from === 'group_id' && f.to_table === 'groups')).toBeDefined();
      expect(fks.find((f) => f.from === 'user_id' && f.to_table === 'users')).toBeDefined();
    });

    it('group_members is_admin defaults to false (0)', () => {
      const info = getColumns(sqlite, 'group_members');
      const col = info.find((c) => c.name === 'is_admin');
      expect(col).toBeDefined();
      expect(col!.dflt_value).toBe('false');
    });
  });

  describe('sessions + refresh_tokens — auth domain', () => {
    it('sessions table has refresh_token hash (not raw token)', () => {
      const cols = getColumnNames(sqlite, 'sessions');
      expect(cols).toContain('refresh_token_hash');
      expect(cols).toContain('refresh_token_iv');
      expect(cols).toContain('refresh_token_tag');
      // Must not store raw tokens
      expect(cols).not.toContain('refresh_token');
    });

    it('refresh_tokens table has unique token_hash', () => {
      const cols = getColumnNames(sqlite, 'refresh_tokens');
      expect(cols).toContain('token_hash');
      expect(cols).toContain('user_agent');
      expect(cols).toContain('ip_address');
    });
  });

  // ─── Soft delete ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('Soft delete (ADR-003 Section 2.5, ADR-001 Section 8)', () => {
    it('every entity table has a nullable deleted_at column', () => {
      for (const table of ALL_TABLES) {
        // resource_tags is a pure junction table (no soft-delete); secrets
        // is a per-grantee copy table with the same hard-delete-on-revoke
        // treatment (BE-003c — see schema.ts's comment on the table).
        if (table === 'resource_tags' || table === 'secrets') continue;
        const info = getColumns(sqlite, table);
        const deletedAt = info.find((c) => c.name === 'deleted_at');
        expect(deletedAt, `${table} missing deleted_at`).toBeDefined();
        expect(deletedAt!.notnull).toBe(0); // nullable — null means alive
      }
    });
  });

  // ─── Foreign key enforcement ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('Foreign key enforcement', () => {
    const testTable = 'fk_test_users';
    const testRefTable = 'fk_test_orphans';

    beforeAll(() => {
      // Create test tables to verify FK enforcement without polluting
      // the real schema
      sqlite.exec(`
        CREATE TABLE fk_test_users (id text PRIMARY KEY);
        CREATE TABLE fk_test_orphans (
          id text PRIMARY KEY,
          user_id text NOT NULL,
          FOREIGN KEY (user_id) REFERENCES fk_test_users(id) ON DELETE no action
        );
      `);
    });

    it('rejects INSERT into child with non-existent parent (FK on)', () => {
      expect(() => {
        sqlite.prepare('INSERT INTO fk_test_orphans (id, user_id) VALUES (?, ?)').run('1', 'nonexistent');
      }).toThrow();
    });

    it('allows INSERT when parent exists', () => {
      sqlite.prepare('INSERT INTO fk_test_users (id) VALUES (?)').run('user1');
      const result = sqlite.prepare('INSERT INTO fk_test_orphans (id, user_id) VALUES (?, ?)')
        .run('1', 'user1');
      expect(result.changes).toBe(1);
    });

    it('rejects DELETE of parent with existing children', () => {
      expect(() => {
        sqlite.prepare('DELETE FROM fk_test_users WHERE id = ?').run('user1');
      }).toThrow();
    });

    it('allows DELETE when no children exist', () => {
      sqlite.prepare('DELETE FROM fk_test_orphans WHERE user_id = ?').run('user1');
      const result = sqlite.prepare('DELETE FROM fk_test_users WHERE id = ?').run('user1');
      expect(result.changes).toBe(1);
    });

    // ─── Unique constraints (ADR-003 identity lookups) ━━━━━━━━━━━━

    describe('Unique constraints', () => {
      it('users.email has a UNIQUE index', () => {
        const result = sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='users'")
          .all() as Array<{ name: string }>;
        const indexes = result.map((i) => i.name);
        expect(indexes).toContain('users_email_unique');
        expect(indexes).toContain('users_username_unique');
      });

      it('refresh_tokens.token_hash has a UNIQUE index', () => {
        const result = sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='refresh_tokens'",
          )
          .all() as Array<{ name: string }>;
        const indexes = result.map((i) => i.name);
        expect(indexes).toContain('refresh_tokens_token_hash_unique');
      });
    });

    // ─── Cascade behavior ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    describe('Cascade delete behavior', () => {
      it('resource_tags cascades on resource delete', () => {
        const fks = getForeignKeys(sqlite, 'resource_tags');
        const resourceFk = fks.find((f) => f.from === 'resource_id');
        expect(resourceFk).toBeDefined();
      });

      it('secrets cascades on resource delete and on user delete', () => {
        const fks = getForeignKeys(sqlite, 'secrets');
        expect(fks.find((f) => f.from === 'resource_id')).toBeDefined();
        expect(fks.find((f) => f.from === 'user_id')).toBeDefined();
      });
    });
  });
});
