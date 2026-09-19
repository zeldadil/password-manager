/**
 * tests/fixtures/crypto.ts — synthetic crypto material + cited RFC test vectors.
 *
 * SEC-001 AR-4: synthetic-only. Everything here is either
 *   (a) generated per run from `node:crypto` randomBytes (never a real key /
 *       salt / nonce / tag / ciphertext), or
 *   (b) a published, citable test vector from an IETF RFC.
 *
 * Nothing here is — or could be — real key material, a real password, or a real
 * token. Values are returned as hex strings so they are trivially auditable and
 * never mistaken for production data.
 */

import { randomBytes } from "node:crypto";

/** High-entropy synthetic master password (AR-4: "per-test random value, never a
 *  dictionary word"). 18 random bytes → 36 hex chars, ~144 bits of entropy. */
export function syntheticMasterPassword(): string {
  return randomBytes(18).toString("hex");
}

/** Synthetic resource secret, e.g. `test-secret-<random>`. Never a human-chosen
 *  or memorized password (AR-4). */
export function syntheticSecret(): string {
  return `test-secret-${randomBytes(16).toString("hex")}`;
}

/** Synthetic symmetric key material of `bytes` length (default 32 → AES-256). */
export function syntheticKey(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/** Synthetic KDF salt (default 16 bytes). */
export function syntheticSalt(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}

/** Synthetic AEAD nonce/IV (default 12 bytes → AES-GCM recommended size). */
export function syntheticNonce(bytes = 12): string {
  return randomBytes(bytes).toString("hex");
}

/** Synthetic AEAD authentication tag (default 16 bytes → GCM tag size). */
export function syntheticTag(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}

/** Synthetic ciphertext blob (opaque, random). Not valid ciphertext — for
 *  exercising parsing/validation paths only. */
export function syntheticCiphertext(bytes = 48): string {
  return randomBytes(bytes).toString("hex");
}

/**
 * Published RFC test vectors (AR-4: "RFC test vectors only", cited inline).
 *
 * `JBSWY3DPEHPK3PXP` is the RFC 4648 §10 base32 encoding test vector (encodes
 * the ASCII string "Hello!"). It is included here for base32/encoding round-trip
 * tests, NOT as a TOTP secret.
 *
 * Note (QA correction): TEST_STRATEGY.md §7 currently labels this vector "TOTP
 * JBSWY3DPEHPK3PXP" — that is a misnomer; it is a base32 vector, not a TOTP key.
 * Actual TOTP vectors live in RFC 6238 Appendix B (secret "12345678901234567890",
 * base32 "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ") and belong to the TOTP task
 * (BR-003d) / packages/crypto tests, not here.
 */
export const RFC_TEST_VECTORS = {
  /** RFC 4648 §10 — base32 encoding test vector. */
  base32: { encoded: "JBSWY3DPEHPK3PXP", decoded: "Hello!", rfc: "RFC 4648 §10" },
} as const;

/**
 * A complete synthetic "key material bundle" for tests that need a full
 * { salt, nonce, tag, ciphertext, key } shape without ever touching a real key.
 */
export function syntheticKeyMaterialBundle(): {
  key: string;
  salt: string;
  nonce: string;
  tag: string;
  ciphertext: string;
} {
  return {
    key: syntheticKey(),
    salt: syntheticSalt(),
    nonce: syntheticNonce(),
    tag: syntheticTag(),
    ciphertext: syntheticCiphertext(),
  };
}
