/**
 * Runs before every test file (vitest.config.ts `setupFiles`).
 *
 * Supplies a complete, deterministic environment so config validation passes
 * without a .env on the machine running the suite. Real values that matter to
 * a phase — the test database, S3 — are overridden from .env where present.
 */

import { existsSync } from 'node:fs';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

process.env['NODE_ENV'] = 'test';

const defaults: Record<string, string> = {
  PORT: '3001',
  MYSQL_URL: 'mysql://root@127.0.0.1:3306/bearlake_test',
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
