/**
 * tests/fixtures/user.ts — synthetic users, sessions, and auth tokens.
 *
 * AR-4: every username/email is on a reserved TLD (`@example.test`); every
 * session token is an opaque, clearly-fake string (`syn-jwt-…` / `syn-refresh-…`),
 * never a real or real-shaped JWT/token. Real JWT encoding is exercised
 * separately in the API integration tests using synthetic payloads.
 */

import { randomBytes } from "node:crypto";
import { syntheticUuid, syntheticTimestamp } from "./identifiers.ts";

/** Synthetic username. Deterministic by index so tests can assert on a stable
 *  value, e.g. syntheticUsername() === "testuser". */
export function syntheticUsername(index = 1): string {
  return index === 1 ? "testuser" : `testuser-${index}`;
}

/** Synthetic email on a reserved TLD (AR-4: `.test` only). */
export function syntheticEmail(index = 1): string {
  return `user-${index}@example.test`;
}

/** Synthetic session access token — opaque and clearly fake, not a JWT. */
export function syntheticAccessToken(): string {
  return `syn-jwt-${randomBytes(24).toString("hex")}`;
}

/** Synthetic refresh token — opaque and clearly fake. */
export function syntheticRefreshToken(): string {
  return `syn-refresh-${randomBytes(24).toString("hex")}`;
}

export interface SyntheticUser {
  id: string;
  username: string;
  email: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: null;
}

/** A synthetic user record (never a real person, never real PII). */
export function syntheticUser(index = 1): SyntheticUser {
  const now = syntheticTimestamp();
  return {
    id: syntheticUuid(),
    username: syntheticUsername(index),
    email: syntheticEmail(index),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

export interface SyntheticSession {
  userId: string;
  accessToken: string;
  refreshToken: string;
  /** Synthetic expiry (15 minutes per SEC-001 Decision 6 / BE-002b). */
  accessExpiresAt: string;
  /** Synthetic expiry (30 days, rotation). */
  refreshExpiresAt: string;
}

/** A synthetic session pair. Tokens are fake; expiries are fixed constants. */
export function syntheticSession(userId?: string): SyntheticSession {
  return {
    userId: userId ?? syntheticUuid(),
    accessToken: syntheticAccessToken(),
    refreshToken: syntheticRefreshToken(),
    accessExpiresAt: syntheticTimestamp(0),
    refreshExpiresAt: syntheticTimestamp(30),
  };
}
