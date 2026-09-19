/**
 * tests/fixtures/identifiers.ts — synthetic IDs and timestamps.
 *
 * UUIDs are generated per run with `crypto.randomUUID()` (unique, synthetic,
 * never a real identifier). Timestamps are fixed synthetic constants so tests
 * never depend on wall-clock time. Both are explicitly synthetic per AR-4.
 */

import { randomUUID } from "node:crypto";

/**
 * A synthetic, unique, RFC 4122 v4 UUID. Generated fresh on every call — never
 * a real id and never reused across runs.
 */
export function syntheticUuid(): string {
  return randomUUID();
}

/**
 * Fixed synthetic timestamp constant (deterministic, no wall-clock). Per
 * TEST_STRATEGY.md §7: "UUIDs/timestamps | generated / fixed synthetic
 * constants (2026-01-01T00:00:00.000Z)".
 */
export const SYNTHETIC_EPOCH = "2026-01-01T00:00:00.000Z";

/** Fixed synthetic timestamp, optionally offset by `days` for ordering tests. */
export function syntheticTimestamp(days = 0): string {
  const base = new Date(SYNTHETIC_EPOCH);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString();
}
