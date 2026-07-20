import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type LogRecord, resetLogSink, setLogSink } from '../src/lib/logger.js';
import { testApp } from './helpers/app.js';

/**
 * Guards plan D26. Later phases extend this file as routes that handle
 * credentials and gate codes come online; the invariant never changes.
 */

let records: LogRecord[] = [];

beforeEach(() => {
  records = [];
  setLogSink((record) => records.push(record));
});

afterEach(() => {
  resetLogSink();
});

function loggedText(): string {
  return records
    .map((r) => `${r.event} ${JSON.stringify(r.fields)}`)
    .join('\n');
}

describe('request logging', () => {
  it('logs the full request path consistently for matched and unmatched routes', async () => {
    await request(testApp()).get('/api/v1/health');
    await request(testApp()).get('/api/v1/nope');

    const paths = records.filter((r) => r.event === 'request').map((r) => r.fields['path']);
    expect(paths).toEqual(['/api/v1/health', '/api/v1/nope']);
  });

  it('never logs the query string', async () => {
    await request(testApp()).get('/api/v1/health?start=2026-07-01&secret=abc123');

    expect(loggedText()).not.toContain('secret');
    expect(loggedText()).not.toContain('abc123');
    expect(loggedText()).toContain('/api/v1/health');
  });

  it('never logs a request body', async () => {
    await request(testApp())
      .post('/api/v1/health')
      .send({ password: 'correct-horse-battery-staple' });

    expect(loggedText()).not.toContain('correct-horse-battery-staple');
    expect(loggedText()).not.toContain('password');
  });
});
