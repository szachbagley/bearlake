import mysql, { type Pool, type PoolOptions } from 'mysql2/promise';
import { type Config, getConfig } from '../config.js';

/**
 * The MySQL connection pool.
 *
 * `dateStrings: true` is load-bearing (plan D14): the driver hands back
 * DATETIME columns as raw strings rather than JavaScript Dates, so no implicit
 * local-timezone conversion can happen between MySQL and the mapper. Every
 * conversion to and from ISO-8601 goes through db/mapper.ts.
 */

export interface ConnectionTarget {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * Resolves the connection target from config, accepting either Railway's
 * MYSQL_URL or its discrete MYSQL* variables.
 *
 * Under NODE_ENV=test the database name is replaced with DB_NAME_TEST. The
 * test suite drops and re-migrates whatever it points at, so this override is
 * the guard that keeps `npm test` from destroying a development database.
 */
export function resolveConnectionTarget(config: Config): ConnectionTarget {
  const { database } = config;

  let target: ConnectionTarget;

  if (database.url !== undefined) {
    const url = new URL(database.url);
    target = {
      host: url.hostname,
      port: url.port === '' ? 3306 : Number(url.port),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    };
  } else {
    target = {
      host: database.host ?? '127.0.0.1',
      port: database.port ?? 3306,
      user: database.user ?? 'root',
      password: database.password ?? '',
      database: database.database ?? '',
    };
  }

  if (config.isTest && config.testDatabaseName !== undefined) {
    target.database = config.testDatabaseName;
  }

  if (target.database === '') {
    throw new Error('No database name configured (MYSQL_URL path or MYSQLDATABASE).');
  }

  return target;
}

export function buildPoolOptions(config: Config): PoolOptions {
  return {
    ...resolveConnectionTarget(config),
    connectionLimit: 10,
    waitForConnections: true,
    dateStrings: true,
    // Applies when a JS Date is ever passed as a parameter. The app passes
    // pre-formatted UTC strings, but this removes the fallback hazard.
    timezone: 'Z',
    charset: 'utf8mb4',
    // Only the migration runner needs multiple statements per call.
    multipleStatements: false,
    supportBigNumbers: true,
  };
}

let pool: Pool | undefined;

export function getPool(): Pool {
  if (pool === undefined) {
    pool = mysql.createPool(buildPoolOptions(getConfig()));

    // The Railway MySQL server's own time zone is not guaranteed to be UTC.
    // Pinning each session means NOW() and CURRENT_TIMESTAMP agree with the
    // UTC strings the application writes.
    pool.on('connection', (connection) => {
      void connection.query("SET time_zone = '+00:00'");
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool !== undefined) {
    const closing = pool;
    pool = undefined;
    await closing.end();
  }
}
