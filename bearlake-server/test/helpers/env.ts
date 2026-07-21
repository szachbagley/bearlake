import { existsSync } from 'node:fs';

/**
 * Deterministic test environment, shared by the per-file setup and the global
 * setup (which run in separate contexts and cannot share the other's work).
 *
 * Real values come from .env where present — the test database in particular —
 * with defaults filling the rest so the suite runs on a bare checkout.
 */
export function applyTestEnv(): void {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }

  process.env['NODE_ENV'] = 'test';

  const defaults: Record<string, string> = {
    PORT: '3001',
    MYSQL_URL: 'mysql://root:bearlake-local@127.0.0.1:3308/bearlake',
    DB_NAME_TEST: 'bearlake_test',
    JWT_SECRET: 'test-secret-that-is-comfortably-long-enough-000',
    WEB_ORIGIN: 'http://localhost:5173',
    AWS_ACCESS_KEY_ID: 'test-access-key-id',
    AWS_SECRET_ACCESS_KEY: 'test-secret-access-key',
    S3_REGION: 'us-west-2',
    S3_BUCKET: 'bearlake-media-test',
  };

  for (const [key, value] of Object.entries(defaults)) {
    process.env[key] ??= value;
  }
}
