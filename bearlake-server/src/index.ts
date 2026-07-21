import { createApp } from './app.js';
import { ConfigError, getConfig } from './config.js';
import { runMigrations } from './db/migrate.js';
import { closePool } from './db/pool.js';
import { loadEnv } from './lib/loadEnv.js';
import { logger } from './lib/logger.js';

/**
 * Boot sequence: load .env (local only) → validate config → run migrations →
 * listen. Migrations complete before the first request is accepted, so the
 * server never serves traffic against a stale schema.
 */

loadEnv();

async function main(): Promise<void> {
  const config = getConfig();

  await runMigrations();

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info('server_started', { port: config.port, env: config.nodeEnv });
  });

  const shutdown = (signal: string): void => {
    logger.info('server_stopping', { signal });

    // No process.exit() on the happy path: it discards queued stdout writes,
    // which on Railway truncates the last log lines of every deploy. Closing
    // the server and the pool removes the only handles keeping the event loop
    // alive, so Node exits on its own once the log has flushed.
    server.close(() => {
      void closePool();
    });

    // Unless something hangs. Unref'd so it never delays a clean exit.
    setTimeout(() => {
      logger.error('shutdown_timed_out');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    logger.error('config_invalid', undefined, { message: err.message });
  } else {
    logger.error('startup_failed', err);
  }
  process.exit(1);
});
