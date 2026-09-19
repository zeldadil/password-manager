/**
 * tests/fixtures/resource.ts — synthetic vault resources and secrets.
 *
 * AR-4: resource names/usernames/URIs are fixed synthetic constants or index
 * patterns on reserved TLDs; secrets come from ./crypto.ts (generated per run,
 * never human-chosen). No real service name, real domain, or real credential.
 */

import { syntheticUuid, syntheticTimestamp } from "./identifiers.ts";
import { syntheticSecret } from "./crypto.ts";

/** Reserved-TLD login URIs only (AR-4: `.test` / `.example.test`). */
export const SYNTHETIC_URIS = [
  "https://app.example.test/login",
  "https://vault.example.test/",
  "https://db.example.test/admin",
  "https://mail.example.test/",
] as const;

/** Fixed synthetic resource types (ADR-003). */
export type SyntheticResourceType = "password" | "note";

/** Synthetic resource name. Deterministic by index (TEST_STRATEGY §7). */
export function syntheticResourceName(index = 1): string {
  return `test-resource-${index}`;
}

/** Synthetic login username for a resource (never a real username). */
export function syntheticResourceUsername(index = 1): string {
  return index === 1 ? "login-example" : `db-test-account-${index}`;
}

export interface SyntheticResource {
  id: string;
  vaultId: string;
  folderId: string | null;
  name: string;
  username: string | null;
  uri: string | null;
  description: string | null;
  resourceType: SyntheticResourceType;
  metadataEncrypted: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: null;
}

/** A synthetic resource (metadata only — the secret is a separate object,
 *  mirroring the resource/secret split in ADR-001/ADR-003). */
export function syntheticResource(
  index = 1,
  overrides: Partial<SyntheticResource> = {},
): SyntheticResource {
  const now = syntheticTimestamp();
  const uri = SYNTHETIC_URIS[(index - 1) % SYNTHETIC_URIS.length];
  return {
    id: syntheticUuid(),
    vaultId: syntheticUuid(),
    folderId: null,
    name: syntheticResourceName(index),
    username: syntheticResourceUsername(index),
    uri,
    description: `synthetic description ${index}`,
    resourceType: "password",
    metadataEncrypted: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

export interface SyntheticSecret {
  id: string;
  resourceId: string;
  userId: string;
  /** Plaintext secret — SYNTHETIC only, generated per run (see ./crypto.ts). */
  secret: string;
  /** Opaque ciphertext placeholder (not valid ciphertext — parsing tests only). */
  ciphertext: string;
  iv: string;
  tag: string;
  createdAt: string;
  updatedAt: string;
}

/** A synthetic secret bound to a resource (generated per run, never real). */
export function syntheticSecretRecord(
  resourceId?: string,
  overrides: Partial<SyntheticSecret> = {},
): SyntheticSecret {
  const now = syntheticTimestamp();
  return {
    id: syntheticUuid(),
    resourceId: resourceId ?? syntheticUuid(),
    userId: syntheticUuid(),
    secret: syntheticSecret(),
    ciphertext: "",
    iv: "",
    tag: "",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
