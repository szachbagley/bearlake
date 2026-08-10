/**
 * Startup configuration (plan W33).
 *
 * `VITE_API_BASE_URL` is the one thing this app cannot run without. Every
 * other `VITE_*` variable is inlined into the public bundle at build time
 * (plan W36) — this module is deliberately the only place that reads one, so
 * it stays easy to audit that nothing else has snuck a secret into `import.meta.env`.
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface AppConfig {
  apiBaseUrl: string;
}

/**
 * Pure validation, deliberately decoupled from `import.meta.env` so tests can
 * call it with plain objects instead of stubbing Vite's env replacement.
 */
export function parseConfig(env: { VITE_API_BASE_URL?: string }): AppConfig {
  const raw = env.VITE_API_BASE_URL;

  if (raw === undefined || raw.trim() === '') {
    throw new ConfigError(
      'VITE_API_BASE_URL is not set. Copy .env.example to .env.local and set it.',
    );
  }

  return { apiBaseUrl: raw.trim() };
}

let cached: AppConfig | undefined;

/**
 * The validated config, resolved once from Vite's env and cached.
 *
 * Reads the **single property**, not `import.meta.env` as a whole. Vite
 * statically replaces `import.meta.env.VITE_FOO` with a literal, but a
 * reference to the bare object forces it to emit the entire env — which
 * shipped the dev-only `VITE_DEV_API_PROXY` into the production bundle
 * until the Phase 9 sweep caught it. Passing one property is what actually
 * makes W36's "only the API base URL is ever exposed" true.
 */
export function getConfig(): AppConfig {
  cached ??= parseConfig({ VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL });
  return cached;
}

/** Test-only: forces the next getConfig() to re-read import.meta.env. */
export function resetConfigCache(): void {
  cached = undefined;
}
