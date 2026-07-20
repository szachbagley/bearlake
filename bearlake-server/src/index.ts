import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { ConfigError, getConfig } from './config.js';
import { logger } from './lib/logger.js';

/**
 * Boot sequence: load .env (local only) → validate config → run migrations
 * (Phase 1) → listen.
 */

if (process.env['NODE_ENV'] !== 'production' && existsSync('.env')) {
  process.loadEnvFile('.env');
}

function main(): void {
  let config;
  try {
    config = getConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error('config_invalid', undefined, { message: err.message });
      process.exit(1);
    }
    throw err;
  }

  // Phase 1 inserts migrations here, before the server accepts traffic.

  const app = createApp();
  app.listen(config.port, () => {
    logger.info('server_started', { port: config.port, env: config.nodeEnv });
  });
}

main();
