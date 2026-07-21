import { existsSync } from 'node:fs';

/**
 * Loads .env for local development. Railway injects real environment
 * variables, so this is a no-op in production.
 *
 * Called by every entry point: the server, the migration runner, and the
 * admin seed script.
 */
export function loadEnv(): void {
  if (process.env['NODE_ENV'] !== 'production' && existsSync('.env')) {
    process.loadEnvFile('.env');
  }
}
