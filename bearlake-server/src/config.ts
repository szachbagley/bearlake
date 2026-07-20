import { z } from 'zod';

/**
 * Environment configuration (plan D30).
 *
 * Validated once, at boot, before anything opens a socket. A misconfigured
 * deployment fails immediately with a list of what is missing rather than
 * half-working until the first request that needs S3.
 */

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),

    // Railway supplies either MYSQL_URL or the discrete MYSQL* variables.
    MYSQL_URL: z.string().min(1).optional(),
    MYSQLHOST: z.string().min(1).optional(),
    MYSQLPORT: z.coerce.number().int().positive().optional(),
    MYSQLUSER: z.string().min(1).optional(),
    MYSQLPASSWORD: z.string().optional(),
    MYSQLDATABASE: z.string().min(1).optional(),

    // Local/test only: the database the test suite drops and re-migrates.
    DB_NAME_TEST: z.string().min(1).optional(),

    JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
    ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(30),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(60),

    WEB_ORIGIN: z.string().default(''),

    // Required in production only; see the check in parseConfig. Phases before
    // uploads exist need to boot locally without an S3 bucket.
    AWS_ACCESS_KEY_ID: z.string().default(''),
    AWS_SECRET_ACCESS_KEY: z.string().default(''),
    S3_REGION: z.string().default(''),
    S3_BUCKET: z.string().default(''),
});

const S3_KEYS = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'S3_REGION', 'S3_BUCKET'] as const;

export interface DatabaseConfig {
  url?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  isTest: boolean;
  isProduction: boolean;
  port: number;
  database: DatabaseConfig;
  testDatabaseName: string | undefined;
  jwtSecret: string;
  accessTokenTtlMinutes: number;
  refreshTokenTtlDays: number;
  webOrigins: string[];
  s3: {
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
}

/** Thrown when the environment is incomplete. Caught at boot; never at runtime. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const result = envSchema.safeParse(env);

  const problems: string[] = result.success
    ? []
    : result.error.issues.map((issue) => {
        const field = issue.path.join('.') || '(env)';
        return `  ${field}: ${issue.message}`;
      });

  // Checked against the raw environment rather than as a schema refinement:
  // an object-level refinement is skipped whenever any other field fails, and
  // a boot failure should list everything that is wrong in one pass.
  if (env.MYSQL_URL === undefined && env.MYSQLHOST === undefined) {
    problems.push(
      '  MYSQL_URL: set either MYSQL_URL or MYSQLHOST/MYSQLUSER/MYSQLDATABASE',
    );
  }

  // A production deployment that cannot presign is broken; a local checkout
  // working through the pre-upload phases is not. S3 config is enforced only
  // where a missing bucket would actually reach a family member.
  if (env.NODE_ENV === 'production') {
    for (const key of S3_KEYS) {
      const value = env[key];
      if (value === undefined || value.length === 0) {
        problems.push(`  ${key}: required in production`);
      }
    }
  }

  if (problems.length > 0) {
    throw new ConfigError(`Invalid environment configuration:\n${problems.join('\n')}`);
  }

  if (!result.success) {
    throw new ConfigError('Invalid environment configuration.');
  }

  const e = result.data;

  const database: DatabaseConfig = {};
  if (e.MYSQL_URL !== undefined) database.url = e.MYSQL_URL;
  if (e.MYSQLHOST !== undefined) database.host = e.MYSQLHOST;
  if (e.MYSQLPORT !== undefined) database.port = e.MYSQLPORT;
  if (e.MYSQLUSER !== undefined) database.user = e.MYSQLUSER;
  if (e.MYSQLPASSWORD !== undefined) database.password = e.MYSQLPASSWORD;
  if (e.MYSQLDATABASE !== undefined) database.database = e.MYSQLDATABASE;

  return {
    nodeEnv: e.NODE_ENV,
    isTest: e.NODE_ENV === 'test',
    isProduction: e.NODE_ENV === 'production',
    port: e.PORT,
    database,
    testDatabaseName: e.DB_NAME_TEST,
    jwtSecret: e.JWT_SECRET,
    accessTokenTtlMinutes: e.ACCESS_TOKEN_TTL_MIN,
    refreshTokenTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
    webOrigins: e.WEB_ORIGIN.split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0),
    s3: {
      region: e.S3_REGION,
      bucket: e.S3_BUCKET,
      accessKeyId: e.AWS_ACCESS_KEY_ID,
      secretAccessKey: e.AWS_SECRET_ACCESS_KEY,
    },
  };
}

let cached: Config | undefined;

/** The validated config. Parsed on first call, then cached for the process. */
export function getConfig(): Config {
  cached ??= parseConfig(process.env);
  return cached;
}

/** Test-only: forces the next getConfig() to re-read process.env. */
export function resetConfigCache(): void {
  cached = undefined;
}
