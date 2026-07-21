import type { NextFunction, Request, Response } from 'express';
import { RateLimitedError } from '../types/errors.js';

/**
 * Login throttling (plan D11).
 *
 * Fixed windows held in memory. Railway runs a single instance, so a shared
 * store would be complexity without benefit; if the deployment ever scales
 * horizontally this becomes per-instance and the limits effectively multiply.
 * That is recorded as a known limitation rather than solved prematurely.
 *
 * Two independent buckets: per email, which stops one account being ground
 * through a password list, and per IP, which stops one source spraying many
 * accounts. The per-IP limit is the looser of the two because a whole family
 * behind one home router shares an address.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_EMAIL = 10;
const MAX_FAILURES_PER_IP = 30;

interface Bucket {
  count: number;
  windowStartedAt: number;
}

const buckets = new Map<string, Bucket>();

function key(kind: 'email' | 'ip', value: string): string {
  return `${kind}:${value}`;
}

function currentCount(bucketKey: string, now: number): number {
  const bucket = buckets.get(bucketKey);
  if (bucket === undefined) return 0;

  if (now - bucket.windowStartedAt >= WINDOW_MS) {
    buckets.delete(bucketKey);
    return 0;
  }

  return bucket.count;
}

function increment(bucketKey: string, now: number): void {
  const bucket = buckets.get(bucketKey);

  if (bucket === undefined || now - bucket.windowStartedAt >= WINDOW_MS) {
    buckets.set(bucketKey, { count: 1, windowStartedAt: now });
    return;
  }

  bucket.count += 1;
}

/** Removes expired buckets so the map cannot grow without bound. */
function prune(now: number): void {
  for (const [bucketKey, bucket] of buckets) {
    if (now - bucket.windowStartedAt >= WINDOW_MS) {
      buckets.delete(bucketKey);
    }
  }
}

export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Checked before the password is verified. Reads the email defensively —
 * this runs ahead of schema validation, so the body may be anything.
 */
export function enforceLoginRateLimit(req: Request, _res: Response, next: NextFunction): void {
  const now = Date.now();
  prune(now);

  const body: unknown = req.body;
  const email =
    typeof body === 'object' && body !== null && 'email' in body ? normalizeEmail(body.email) : '';
  const ip = req.ip ?? 'unknown';

  if (email !== '' && currentCount(key('email', email), now) >= MAX_FAILURES_PER_EMAIL) {
    next(new RateLimitedError());
    return;
  }

  if (currentCount(key('ip', ip), now) >= MAX_FAILURES_PER_IP) {
    next(new RateLimitedError());
    return;
  }

  next();
}

export function recordLoginFailure(email: string, ip: string): void {
  const now = Date.now();
  if (email !== '') increment(key('email', email), now);
  increment(key('ip', ip), now);
}

/** A successful login clears that account's and that source's counters. */
export function recordLoginSuccess(email: string, ip: string): void {
  buckets.delete(key('email', email));
  buckets.delete(key('ip', ip));
}

/** Test-only: forget every counter. */
export function resetRateLimits(): void {
  buckets.clear();
}
