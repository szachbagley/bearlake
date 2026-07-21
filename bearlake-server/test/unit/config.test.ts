import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from '../../src/config.js';

const complete = {
  NODE_ENV: 'test',
  MYSQL_URL: 'mysql://root@127.0.0.1:3306/bearlake_test',
  JWT_SECRET: 'a-secret-that-is-at-least-32-characters-long',
  AWS_ACCESS_KEY_ID: 'key',
  AWS_SECRET_ACCESS_KEY: 'secret',
  S3_REGION: 'us-west-2',
  S3_BUCKET: 'bucket',
};

describe('config', () => {
  it('applies documented defaults', () => {
    const config = parseConfig(complete);

    expect(config.port).toBe(3000);
    expect(config.accessTokenTtlMinutes).toBe(30);
    expect(config.refreshTokenTtlDays).toBe(60);
    expect(config.webOrigins).toEqual([]);
  });

  it('splits and trims the CORS allowlist', () => {
    const config = parseConfig({
      ...complete,
      WEB_ORIGIN: 'http://localhost:5173, https://admin.example.com ',
    });

    expect(config.webOrigins).toEqual(['http://localhost:5173', 'https://admin.example.com']);
  });

  it('names every missing variable in one pass when the environment is incomplete', () => {
    expect(() => parseConfig({ NODE_ENV: 'production' })).toThrow(ConfigError);

    try {
      parseConfig({ NODE_ENV: 'production' });
      expect.unreachable('parseConfig should have thrown');
    } catch (err) {
      const message = (err as ConfigError).message;
      // All three classes of problem must appear together, so an operator
      // fixing the deployment does not discover them one restart at a time.
      expect(message).toContain('JWT_SECRET');
      expect(message).toContain('S3_BUCKET');
      expect(message).toContain('MYSQL_URL');
    }
  });

  it('requires S3 configuration in production only', () => {
    const { S3_BUCKET: _bucket, S3_REGION: _region, ...withoutS3 } = complete;

    expect(() => parseConfig({ ...withoutS3, NODE_ENV: 'development' })).not.toThrow();
    expect(() => parseConfig({ ...withoutS3, NODE_ENV: 'production' })).toThrow(/S3_BUCKET/);
  });

  it('rejects a short JWT secret', () => {
    expect(() => parseConfig({ ...complete, JWT_SECRET: 'too-short' })).toThrow(/JWT_SECRET/);
  });

  it('accepts the discrete Railway MySQL variables in place of a URL', () => {
    const { MYSQL_URL: _omitted, ...withoutUrl } = complete;
    const config = parseConfig({
      ...withoutUrl,
      MYSQLHOST: 'containers.railway.app',
      MYSQLPORT: '7777',
      MYSQLUSER: 'root',
      MYSQLDATABASE: 'railway',
    });

    expect(config.database.host).toBe('containers.railway.app');
    expect(config.database.port).toBe(7777);
    expect(config.database.url).toBeUndefined();
  });
});
