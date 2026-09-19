/**
 * tests/fixtures/index.ts — barrel export for the synthetic fixture factories.
 *
 * Everything is synthetic (SEC-001 AR-4): no real passwords, keys, tokens,
 * usernames, URLs, or resource names. Import with an explicit `.ts` extension
 * (bundler / node --experimental-strip-types compatible) or extend the paths
 * via tsconfig `allowImportingTsExtensions`.
 */

export * from "./seed.ts";
export * from "./identifiers.ts";
export * from "./crypto.ts";
export * from "./user.ts";
export * from "./resource.ts";
export * from "./folder.ts";
export * from "./tag.ts";
