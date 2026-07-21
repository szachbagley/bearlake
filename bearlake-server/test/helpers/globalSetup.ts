import mysql from 'mysql2/promise';
import { getConfig, resetConfigCache } from '../../src/config.js';
import { runMigrations } from '../../src/db/migrate.js';
import { buildPoolOptions, resolveConnectionTarget } from '../../src/db/pool.js';
import { closePool } from '../../src/db/pool.js';
import { applyTestEnv } from './env.js';

/**
 * Runs once per `npm test`: drops every table in the test database and
 * re-applies the migrations from scratch.
 *
 * Starting from an empty schema each run is what keeps a migration that was
 * edited after being applied from passing locally and failing on deploy.
 */
export default async function setup(): Promise<void> {
  applyTestEnv();
  resetConfigCache();

  const config = getConfig();
  const target = resolveConnectionTarget(config);

  if (config.testDatabaseName === undefined || target.database !== config.testDatabaseName) {
    throw new Error(
      `Refusing to run: tests would target "${target.database}" instead of DB_NAME_TEST.`,
    );
  }

  const connection = await mysql.createConnection(buildPoolOptions(config));
  try {
    const [tables] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ?',
      [target.database],
    );

    if (tables.length > 0) {
      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      for (const table of tables) {
        await connection.query(`DROP TABLE IF EXISTS \`${String(table['name'])}\``);
      }
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    }
  } finally {
    await connection.end();
  }

  await runMigrations();
  await closePool();
}
