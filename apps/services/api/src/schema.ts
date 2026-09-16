/**
 * Drizzle ORM schema for the Secure Password Manager.
 *
 * Implements the data model defined in ADR-003 (Data Model), which is
 * the schema-level refinement of ADR-002 (Overall Architecture) and
 * references ADR-001 (functional patterns from Passbolt) for the
 * resource/secret split, permission-mask, and group-as-ARO patterns.
 *
 * DB: SQLite v1 (dev). Migrations are DB-agnostic where possible
 * (UUIDs as TEXT, JSON as TEXT, timestamps as INTEGER epoch).
 * Postgres migration target is documented in ADR-003 Section 9.2.
 *
 * Crypto boundary: per ADR-002 Section 5.1, only User (salt, kdfParams,
 * vaultKeyEncrypted, recoveryKit*) and Resource (secretCiphertext,
 * metadata*) carry cryptographic material. All other columns are
 * plaintext metadata. No crypto is performed in this file — columns
 * store opaque blobs. Crypto code lives in BE-002a + packages/crypto/
 * (gated by SEC-001).
 */

import { sqliteTable, text, integer, blob, foreignKey } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// ─── Common column helpers ──────────────────────────────────────────────

/**
 * UUID v4 stored as TEXT (RFC 4122 string format).
 * SQLite has no native UUID type; TEXT is portable to Postgres.
 */
const uuid = (name: string) => text(name);

/** Soft-delete timestamp — null = alive, set = deleted at this time. */
const deletedAt = () => integer('deleted_at', { mode: 'timestamp' });

/** Server-set timestamps (UTC, Unix epoch ms). */
const createdAt = () => integer('created_at', { mode: 'timestamp' });
const updatedAt = () => integer('updated_at', { mode: 'timestamp' });

/** Boolean stored as INTEGER 0/1 (SQLite has no native BOOLEAN). */
const booleanCol = (name: string) => integer(name, { mode: 'boolean' });

// ─── User ──────────────────────────────────────────────────────────────
// ADR-003 Section 3.1. Only User carries KDF + vault-key material.

export const users = sqliteTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  username: text('username').notNull().unique(),

  // KDF material — ADR-003 Section 3.1 / SEC-001 Decision 1
  // NEVER store masterPasswordHash — master password is transient input only.
  salt: blob('salt', { mode: 'buffer' }).notNull(),
  kdfParams: text('kdf_params', { mode: 'json' }).notNull(),

  // Vault key storage — SEC-001 Decision 3
  // Plaintext vault key is NEVER in the DB — only encrypted blob + IV + tag.
  vaultKeyEncrypted: blob('vault_key_encrypted', { mode: 'buffer' }).notNull(),
  vaultKeyIv: blob('vault_key_iv', { mode: 'buffer' }).notNull(),
  vaultKeyTag: blob('vault_key_tag', { mode: 'buffer' }).notNull(),

  // Recovery kit — SEC-001 Decision 7 (nullable until user creates one)
  recoveryKitEncrypted: blob('recovery_kit_encrypted', { mode: 'buffer' }),
  recoveryKitIv: blob('recovery_kit_iv', { mode: 'buffer' }),
  recoveryKitTag: blob('recovery_kit_tag', { mode: 'buffer' }),

  // MFA — ADR-003 Section 3.1 (nullable — MVP is TOTP only)
  mfaSecret: blob('mfa_secret', { mode: 'buffer' }),

  // Non-secret preferences
  settings: text('settings', { mode: 'json' }).notNull().default('{}'),

  createdAt: createdAt().notNull(),
  updatedAt: updatedAt().notNull(),
  deletedAt: deletedAt(),
});

// ─── Vault ─────────────────────────────────────────────────────────────
// ADR-003 Section 3.2. 1:1 with User in MVP.

export const vaults = sqliteTable('vaults', {
  id: uuid('id').primaryKey(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'no action' }),

  name: text('name').notNull(),
  description: text('description'),

  // Format version for vault-internal migrations (ADR-003 Section 3.2)
  version: integer('version').notNull().default(1),

  createdAt: createdAt().notNull(),
  updatedAt: updatedAt().notNull(),
  deletedAt: deletedAt(),
});

// ─── Folder ────────────────────────────────────────────────────────────
// ADR-003 Section 3.4. Self-referential tree via parentId.

export const folders = sqliteTable('folders', {
  id: uuid('id').primaryKey(),
  vaultId: uuid('vault_id')
    .notNull()
    .references(() => vaults.id, { onDelete: 'no action' }),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'no action' }),

  name: text('name').notNull(),

  // Self-referential tree (ADR-003 Section 3.4).
  // The FK is declared via the table callback's foreignKey() below to
  // avoid a TypeScript self-reference cycle (folders referencing itself
  // inside its own initializer — TS7022 on TS strict mode).
  parentId: uuid('parent_id'),

  description: text('description'),
  icon: text('icon'),
  color: text('color'),

  // Permission mask — ADR-003 Section 3.4 / 3.5 / 8.1 #3
  // Applied to resources at create/move time. Stored as three nullable
  // columns (level + granteeType + granteeId).
  permissionMaskLevel: text('permission_mask_level'), // 'read' | 'update' | 'owner'
  permissionMaskGranteeType: text('permission_mask_grantee_type'), // 'user' | 'group'
  permissionMaskGranteeId: uuid('permission_mask_grantee_id'),

  createdAt: createdAt().notNull(),
  updatedAt: updatedAt().notNull(),
  deletedAt: deletedAt(),
}, (table) => ({
  folders_parent_folders_fk: foreignKey({
    columns: [table.parentId],
    foreignColumns: [table.id],
  }),
}));

// ─── Resource ──────────────────────────────────────────────────────────
// ADR-003 Section 3.3. Resource/secret split per ADR-001 Section 1.

export const resources = sqliteTable('resources', {
  id: uuid('id').primaryKey(),
  vaultId: uuid('vault_id')
    .notNull()
    .references(() => vaults.id, { onDelete: 'no action' }),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'no action' }),

  name: text('name').notNull(),
  username: text('username'),
  uri: text('uri'),
  description: text('description'),

  // Fixed resource types in V1 (ADR-003 Section 3.3)
  type: text('type').notNull(),

  // Encrypted secret payload — ADR-003 Section 3.3 / SEC-001 Decision 2
  // NEVER plaintext in DB. AEAD ciphertext + IV + tag.
  secretCiphertext: blob('secret_ciphertext', { mode: 'buffer' }).notNull(),
  secretIv: blob('secret_iv', { mode: 'buffer' }).notNull(),
  secretTag: blob('secret_tag', { mode: 'buffer' }).notNull(),
  secretNonce: blob('secret_nonce', { mode: 'buffer' }),

  // Metadata encryption opt-in (ADR-003 Section 3.3 / ADR-001 Section 1)
  metadataEncrypted: booleanCol('metadata_encrypted').notNull().default(false),
  metadataCiphertext: blob('metadata_ciphertext', { mode: 'buffer' }),
  metadataIv: blob('metadata_iv', { mode: 'buffer' }),
  metadataTag: blob('metadata_tag', { mode: 'buffer' }),

  // Lightweight V1 favorite flag (ADR-003 Section 8.2 #3)
  favorite: booleanCol('favorite').notNull().default(false),

  // Folder assignment — null = vault root (ADR-003 Section 3.3)
  folderId: uuid('folder_id').references(() => folders.id, {
    onDelete: 'no action',
  }),

  createdAt: createdAt().notNull(),
  updatedAt: updatedAt().notNull(),
  deletedAt: deletedAt(),
});

// ─── Tag ───────────────────────────────────────────────────────────────
// ADR-003 Section 3.6. Flat, many-to-many with resources.

export const tags = sqliteTable('tags', {
  id: uuid('id').primaryKey(),
  vaultId: uuid('vault_id')
    .notNull()
    .references(() => vaults.id, { onDelete: 'no action' }),

  name: text('name').notNull(),
  color: text('color'),

  createdAt: createdAt().notNull(),
  updatedAt: updatedAt().notNull(),
  deletedAt: deletedAt(),
});

// ─── Resource ↔ Tag junction ────────────────────────────────────────────
// ADR-003 Section 8.1 Open Q1 (resolved: junction table for portability)

export const resourceTags = sqliteTable('resource_tags', {
  resourceId: uuid('resource_id')
    .notNull()
    .references(() => resources.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id')
    .notNull()
    .references(() => tags.id, { onDelete: 'cascade' }),
});

// ─── Permission ────────────────────────────────────────────────────────
// ADR-003 Section 3.5 / ADR-001 Section 5. Enum levels 1/7/15.

export const permissions = sqliteTable('permissions', {
  id: uuid('id').primaryKey(),

  // Target entity (ADR-003 Section 3.5)
  targetType: text('target_type').notNull(), // 'resource' | 'folder' | 'vault'
  targetId: uuid('target_id').notNull(),

  // Grantee (ADR-003 Section 3.5 / ADR-001 Section 4 group-as-ARO)
  granteeType: text('grantee_type').notNull(), // 'user' | 'group'
  granteeId: uuid('grantee_id').notNull(),

  // Permission level (ADR-003 Section 3.5 / ADR-001 Section 5)
  level: text('level').notNull(), // 'read' | 'update' | 'owner'

  // Audit — who granted it (ADR-003 Section 3.5)
  grantedBy: uuid('granted_by')
    .notNull()
    .references(() => users.id, { onDelete: 'no action' }),

  createdAt: createdAt().notNull(),
  updatedAt: updatedAt().notNull(),
  deletedAt: deletedAt(),
});

// ─── Group ─────────────────────────────────────────────────────────────
// ADR-003 Section 3.7. Post-MVP schema but defined for coherence.

export const groups = sqliteTable('groups', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'no action' }),

  createdAt: createdAt().notNull(),
  updatedAt: updatedAt().notNull(),
  deletedAt: deletedAt(),
});

// ─── Group membership junction ─────────────────────────────────────────
// ADR-003 Section 3.7.

export const groupMembers = sqliteTable('group_members', {
  id: uuid('id').primaryKey(),
  groupId: uuid('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  isAdmin: booleanCol('is_admin').notNull().default(false),

  createdAt: createdAt().notNull(),
  updatedAt: updatedAt().notNull(),
  deletedAt: deletedAt(),
});

// ─── Auth domain tables ────────────────────────────────────────────────
// Included in baseline migration so auth flow (BE-002a–BE-002h) storage
// is ready. SEC-001 is satisfied: column shapes only, no crypto code,
// no plaintext secrets, no KDF logic. Crypto lives in BE-002a and
// packages/crypto/ (ADR-002 Section 5.1).

export const sessions = sqliteTable('sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  // JWT fingerprint — we never store the token itself (SEC-001)
  refreshTokenHash: text('refresh_token_hash').notNull(),
  refreshTokenIv: blob('refresh_token_iv', { mode: 'buffer' }),
  refreshTokenTag: blob('refresh_token_tag', { mode: 'buffer' }),

  // Server-side vault key — held in memory only during active session
  // (SEC-001 Decision 6). If stored at rest, encrypted under a
  // per-session key, never plaintext.
  vaultKeyEncrypted: blob('vault_key_encrypted', { mode: 'buffer' }),
  vaultKeyIv: blob('vault_key_iv', { mode: 'buffer' }),
  vaultKeyTag: blob('vault_key_tag', { mode: 'buffer' }),

  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),

  createdAt: createdAt().notNull(),
  updatedAt: updatedAt().notNull(),
  deletedAt: deletedAt(),
});

export const refreshTokens = sqliteTable('refresh_tokens', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  // We store only a hash to detect reuse — the raw token is returned
  // to the client exactly once and never persisted (SEC-001 Decision 6)
  tokenHash: text('token_hash').notNull().unique(),

  // Device metadata (non-secret)
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),

  issuedAt: integer('issued_at', { mode: 'timestamp' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),

  createdAt: createdAt().notNull(),
  updatedAt: updatedAt().notNull(),
  deletedAt: deletedAt(),
});

// ─── Relations ─────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  vaults: many(vaults),
  resources: many(resources),
  folders: many(folders),
  permissions: many(permissions),
  sessions: many(sessions),
  refreshTokens: many(refreshTokens),
  groupMemberships: many(groupMembers),
}));

export const vaultsRelations = relations(vaults, ({ one, many }) => ({
  owner: one(users, { fields: [vaults.ownerId], references: [users.id] }),
  resources: many(resources),
  folders: many(folders),
  tags: many(tags),
}));

export const foldersRelations = relations(folders, ({ one, many }) => ({
  vault: one(vaults, { fields: [folders.vaultId], references: [vaults.id] }),
  owner: one(users, { fields: [folders.ownerId], references: [users.id] }),
  parent: one(folders, {
    fields: [folders.parentId],
    references: [folders.id],
  }),
  children: many(folders),
  resources: many(resources),
}));

export const resourcesRelations = relations(resources, ({ one, many }) => ({
  vault: one(vaults, { fields: [resources.vaultId], references: [vaults.id] }),
  owner: one(users, { fields: [resources.ownerId], references: [users.id] }),
  folder: one(folders, { fields: [resources.folderId], references: [folders.id] }),
  resourceTags: many(resourceTags),
}));

export const tagsRelations = relations(tags, ({ one, many }) => ({
  vault: one(vaults, { fields: [tags.vaultId], references: [vaults.id] }),
  resourceTags: many(resourceTags),
}));

export const resourceTagsRelations = relations(resourceTags, ({ one }) => ({
  resource: one(resources, {
    fields: [resourceTags.resourceId],
    references: [resources.id],
  }),
  tag: one(tags, {
    fields: [resourceTags.tagId],
    references: [tags.id],
  }),
}));

export const permissionsRelations = relations(permissions, ({ one }) => ({
  grantor: one(users, { fields: [permissions.grantedBy], references: [users.id] }),
}));

export const groupsRelations = relations(groups, ({ one, many }) => ({
  owner: one(users, { fields: [groups.ownerId], references: [users.id] }),
  members: many(groupMembers),
}));

export const groupMembersRelations = relations(groupMembers, ({ one }) => ({
  group: one(groups, { fields: [groupMembers.groupId], references: [groups.id] }),
  user: one(users, { fields: [groupMembers.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));

// ─── Schema export ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const schema = {
  users,
  vaults,
  folders,
  resources,
  tags,
  resourceTags,
  permissions,
  groups,
  groupMembers,
  sessions,
  refreshTokens,
  usersRelations,
  vaultsRelations,
  foldersRelations,
  resourcesRelations,
  tagsRelations,
  resourceTagsRelations,
  permissionsRelations,
  groupsRelations,
  groupMembersRelations,
  sessionsRelations,
  refreshTokensRelations,
};
