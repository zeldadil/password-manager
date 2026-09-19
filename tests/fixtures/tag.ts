/**
 * tests/fixtures/tag.ts — synthetic flat tags.
 *
 * AR-4: tag names are fixed synthetic constants (flat, non-hierarchical, per
 * ADR-001 §3). No real labels.
 */

import { syntheticUuid, syntheticTimestamp } from "./identifiers.ts";
import { seededRandom, pick } from "./seed.ts";

/** Fixed synthetic tag vocabulary (TEST_STRATEGY §7: "test", "integration", …). */
export const SYNTHETIC_TAGS = [
  "test",
  "integration",
  "fixture",
  "work",
  "personal",
] as const;

export interface SyntheticTag {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: null;
}

/** A synthetic tag. `index` picks from the fixed vocabulary cyclically; pass a
 *  name directly for an explicit label. */
export function syntheticTag(index = 1): SyntheticTag {
  const now = syntheticTimestamp();
  const name = SYNTHETIC_TAGS[(index - 1) % SYNTHETIC_TAGS.length];
  return { id: syntheticUuid(), name, createdAt: now, updatedAt: now, deletedAt: null };
}

/** A deterministic, varied list of synthetic tags (seeded, reproducible). */
export function syntheticTagList(count = 5): SyntheticTag[] {
  const rng = seededRandom();
  const out: SyntheticTag[] = [];
  for (let i = 0; i < count; i++) {
    const name = pick(rng, SYNTHETIC_TAGS);
    const now = syntheticTimestamp();
    out.push({ id: syntheticUuid(), name, createdAt: now, updatedAt: now, deletedAt: null });
  }
  return out;
}
