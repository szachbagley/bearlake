import type { NextFunction, Request, Response } from 'express';
import { ZodError, z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { resetLogSink, setLogSink } from '../../src/lib/logger.js';
import { ForbiddenError, NotFoundError } from '../../src/types/errors.js';

/**
 * The error middleware is the only place a status code is chosen and the only
 * thing that shapes an error body. These tests pin the guarantee that internal
 * detail — SQL text, stack traces, driver error codes — never reaches a client.
 */

interface Captured {
  status: number;
  body: unknown;
}

function run(err: unknown): Captured {
  const captured: Captured = { status: 0, body: undefined };
  const res = {
    headersSent: false,
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
  } as unknown as Response;

  errorHandler(err, {} as Request, res, (() => undefined) as NextFunction);
  return captured;
}

describe('errorHandler', () => {
  it('maps a typed ApiError to its status and code', () => {
    expect(run(new NotFoundError()).status).toBe(404);
    const forbidden = run(new ForbiddenError());
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toEqual({
      error: { code: 'FORBIDDEN', message: expect.any(String) as string },
    });
  });

  it('maps a ZodError to a 400 validation error', () => {
    const parsed = z.object({ x: z.number() }).safeParse({ x: 'no' });
    const err = parsed.success ? new ZodError([]) : parsed.error;

    const result = run(err);
    expect(result.status).toBe(400);
    expect((result.body as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });

  it('never leaks internals from an unexpected error', () => {
    // Stand in for a driver failure: a real one carries a `.code`, a `.sql`
    // string, and a stack — none of which may reach the client.
    const dbError = Object.assign(new Error('ER_PARSE_ERROR: near SELECT * FROM users WHERE'), {
      code: 'ER_PARSE_ERROR',
      sql: 'SELECT * FROM users WHERE secret = 0000',
    });

    const captured: string[] = [];
    setLogSink((record) => captured.push(JSON.stringify(record)));
    try {
      const result = run(dbError);

      expect(result.status).toBe(500);
      expect(result.body).toEqual({
        error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' },
      });
      // The body carries no SQL, no driver code, no stack.
      const serialized = JSON.stringify(result.body);
      expect(serialized).not.toContain('ER_PARSE_ERROR');
      expect(serialized).not.toContain('SELECT');
      expect(serialized).not.toContain('secret');
    } finally {
      resetLogSink();
    }

    // The detail is logged server-side, where operators can see it.
    expect(captured.join('\n')).toContain('unhandled_error');
  });

  it('treats a thrown TypeError as a generic 500', () => {
    const result = run(new TypeError("Cannot read properties of undefined (reading 'id')"));

    expect(result.status).toBe(500);
    expect((result.body as { error: { code: string } }).error.code).toBe('INTERNAL');
    expect(JSON.stringify(result.body)).not.toContain('undefined');
  });

  it('delegates to next when the response has already started', () => {
    const next = vi.fn();
    const res = { headersSent: true } as unknown as Response;
    errorHandler(new Error('too late'), {} as Request, res, next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });
});
