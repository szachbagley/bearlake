import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../lib/logger.js';
import { ApiError, ErrorCode } from '../types/errors.js';

/** The one error shape the API ever returns. */
interface ErrorBody {
  error: { code: string; message: string };
}

/** body-parser rejects malformed or oversized JSON before any route runs. */
interface BodyParserError extends Error {
  type: string;
  status?: number;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return err instanceof Error && typeof (err as Partial<BodyParserError>).type === 'string';
}

function zodMessage(err: ZodError): string {
  const details = err.issues
    .slice(0, 5)
    .map((issue) => {
      const field = issue.path.join('.');
      return field.length > 0 ? `${field}: ${issue.message}` : issue.message;
    })
    .join('; ');
  return `The request was not valid. ${details}`;
}

/**
 * Centralized error mapping (plan D31). Handlers and services throw typed
 * errors; this is the only place a status code is chosen.
 *
 * Anything unrecognized becomes a generic 500 — SQL text, stack traces, and
 * file paths are logged server-side and never sent to a client.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  let status: number;
  let body: ErrorBody;

  if (err instanceof ApiError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message } };
  } else if (err instanceof ZodError) {
    status = 400;
    body = { error: { code: ErrorCode.VALIDATION_ERROR, message: zodMessage(err) } };
  } else if (isBodyParserError(err) && err.type === 'entity.too.large') {
    status = 413;
    body = {
      error: { code: ErrorCode.PAYLOAD_TOO_LARGE, message: 'That request body is too large.' },
    };
  } else if (isBodyParserError(err)) {
    status = 400;
    body = {
      error: { code: ErrorCode.VALIDATION_ERROR, message: 'The request body could not be read.' },
    };
  } else {
    status = 500;
    body = {
      error: { code: ErrorCode.INTERNAL, message: 'Something went wrong. Please try again.' },
    };
  }

  if (status >= 500) {
    logger.error('unhandled_error', err, { status });
  }

  res.status(status).json(body);
}
