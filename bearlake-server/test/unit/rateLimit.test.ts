import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  enforceLoginRateLimit,
  normalizeEmail,
  recordLoginFailure,
  recordLoginSuccess,
  resetRateLimits,
} from '../../src/middleware/rateLimit.js';

/**
 * Window expiry is exercised here rather than through HTTP, because the
 * alternative is a test that waits fifteen real minutes.
 */

afterEach(() => {
  resetRateLimits();
  vi.useRealTimers();
});

/** Drives the limiter the way the login route does and reports the outcome. */
function attempt(email: string, ip: string): 'allowed' | 'limited' {
  const limited = isLimited(email, ip);
  if (!limited) recordLoginFailure(email, ip);
  return limited ? 'limited' : 'allowed';
}

function isLimited(email: string, ip: string): boolean {
  let outcome = false;
  const req = { body: { email }, ip } as unknown as Parameters<typeof enforceLoginRateLimit>[0];
  enforceLoginRateLimit(req, {} as never, (err?: unknown) => {
    outcome = err !== undefined;
  });
  return outcome;
}

describe('login rate limiting', () => {
  it('allows ten failures per email and blocks the eleventh', () => {
    for (let i = 0; i < 10; i += 1) {
      expect(attempt('zach@example.com', '10.0.0.1'), `attempt ${String(i + 1)}`).toBe('allowed');
    }
    expect(attempt('zach@example.com', '10.0.0.1')).toBe('limited');
  });

  it('keeps separate counts per email', () => {
    for (let i = 0; i < 10; i += 1) attempt('zach@example.com', '10.0.0.1');

    expect(isLimited('zach@example.com', '10.0.0.1')).toBe(true);
    expect(isLimited('rachel@example.com', '10.0.0.1')).toBe(false);
  });

  it('blocks a source spraying many different accounts', () => {
    // Each account stays under its own limit; the shared address does not.
    for (let i = 0; i < 30; i += 1) {
      expect(attempt(`user${String(i)}@example.com`, '10.0.0.9')).toBe('allowed');
    }
    expect(isLimited('someone-new@example.com', '10.0.0.9')).toBe(true);
  });

  it('does not let one address lock out another', () => {
    for (let i = 0; i < 30; i += 1) attempt(`user${String(i)}@example.com`, '10.0.0.9');

    expect(isLimited('someone@example.com', '10.0.0.10')).toBe(false);
  });

  it('clears both counters on a successful sign-in', () => {
    for (let i = 0; i < 10; i += 1) attempt('zach@example.com', '10.0.0.1');
    expect(isLimited('zach@example.com', '10.0.0.1')).toBe(true);

    recordLoginSuccess('zach@example.com', '10.0.0.1');

    expect(isLimited('zach@example.com', '10.0.0.1')).toBe(false);
  });

  it('forgets failures once the window has passed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T16:00:00.000Z'));

    for (let i = 0; i < 10; i += 1) attempt('zach@example.com', '10.0.0.1');
    expect(isLimited('zach@example.com', '10.0.0.1')).toBe(true);

    vi.setSystemTime(new Date('2026-07-17T16:14:59.000Z'));
    expect(isLimited('zach@example.com', '10.0.0.1')).toBe(true);

    vi.setSystemTime(new Date('2026-07-17T16:15:01.000Z'));
    expect(isLimited('zach@example.com', '10.0.0.1')).toBe(false);
  });

  it('normalizes the email so case and padding cannot split a bucket', () => {
    expect(normalizeEmail('  ZACH@Example.COM ')).toBe('zach@example.com');

    for (let i = 0; i < 10; i += 1) attempt('zach@example.com', '10.0.0.1');

    // The same account under different spellings must hit the same counter.
    expect(isLimited('ZACH@Example.COM', '10.0.0.2')).toBe(true);
  });
});
