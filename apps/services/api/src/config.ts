/** @fileoverview Runtime configuration for the API service.

 * Single source of truth for the version string is the package.json
 * `version` field (currently 0.1.0 pre-release). Host/port/nodeEnv come
 * from the environment so the same binary runs in dev, test, and prod.
 *
 * Security boundary (ADR-002 Sec 5.1, SEC-001 AR-2): this module holds NO
 * secrets — only non-secret runtime knobs. Master passwords, vault keys,
 * salts, and ciphertext never pass through here.
 */

import { readFileSync } from 'node:fs';

interface PackageJson {
  name: string;
  version: string;
}

const pkgPath = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson;

export interface ApiConfig {
  /** Semver from package.json (e.g. "0.1.0"). */
  readonly version: string;
  /** Package name (e.g. "@password-manager/api"). */
  readonly name: string;
  /** TCP port to listen on (env: PORT, default 3000). */
  readonly port: number;
  /** Host/interface to bind (env: HOST, default 127.0.0.1). */
  readonly host: string;
  /** NODE_ENV — "development" | "test" | "production". */
  readonly nodeEnv: string;
  /**
   * Auto-lock timeout in milliseconds.
   * If a session has no activity (no refresh) for longer than this,
   * the session is considered auto-locked and the user must re-unlock
   * with their master password. Default: 15 minutes.
   * Env: AUTO_LOCK_TIMEOUT_MS (integer milliseconds).
   */
  readonly autoLockTimeoutMs: number;
}

export const config: ApiConfig = {
  version: pkg.version,
  name: pkg.name,
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '127.0.0.1',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  autoLockTimeoutMs: parseInt(process.env.AUTO_LOCK_TIMEOUT_MS ?? '', 10) || 15 * 60 * 1000,
};
