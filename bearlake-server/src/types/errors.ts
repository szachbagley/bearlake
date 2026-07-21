/**
 * Error taxonomy (plan D31).
 *
 * Services and middleware throw these; one error-handling middleware maps them
 * to `{ error: { code, message } }`. Every `message` here is safe to display to
 * a family member — no SQL text, no stack traces, no internal identifiers.
 */

export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  NOT_FOUND: 'NOT_FOUND',
  STALE_ARTICLE: 'STALE_ARTICLE',
  CATEGORY_NOT_EMPTY: 'CATEGORY_NOT_EMPTY',
  EMAIL_IN_USE: 'EMAIL_IN_USE',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCodeValue;

  constructor(status: number, code: ErrorCodeValue, message: string) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
  }
}

export class ValidationError extends ApiError {
  constructor(message = 'The request was not valid.') {
    super(400, ErrorCode.VALIDATION_ERROR, message);
  }
}

/** Login failure. Deliberately identical for unknown email, wrong password,
 *  and deactivated account — never reveal which accounts exist (plan D12). */
export class InvalidCredentialsError extends ApiError {
  constructor(message = 'Incorrect email or password.') {
    super(401, ErrorCode.INVALID_CREDENTIALS, message);
  }
}

export class UnauthenticatedError extends ApiError {
  constructor(message = 'You are not signed in.') {
    super(401, ErrorCode.UNAUTHENTICATED, message);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'You do not have permission to do that.') {
    super(403, ErrorCode.FORBIDDEN, message);
  }
}

export class PasswordChangeRequiredError extends ApiError {
  constructor(message = 'You must change your password before continuing.') {
    super(403, ErrorCode.PASSWORD_CHANGE_REQUIRED, message);
  }
}

export class AccountDisabledError extends ApiError {
  constructor(message = 'This account is no longer active.') {
    super(403, ErrorCode.ACCOUNT_DISABLED, message);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'That item could not be found.') {
    super(404, ErrorCode.NOT_FOUND, message);
  }
}

export class StaleArticleError extends ApiError {
  constructor(message = 'This article was changed by someone else. Reload it and try again.') {
    super(409, ErrorCode.STALE_ARTICLE, message);
  }
}

export class CategoryNotEmptyError extends ApiError {
  constructor(message = 'Move or delete this category’s articles before deleting it.') {
    super(409, ErrorCode.CATEGORY_NOT_EMPTY, message);
  }
}

/**
 * Only ever returned to an admin creating an account, so it discloses nothing
 * to an anonymous caller — account enumeration is not a concern on this route.
 */
export class EmailInUseError extends ApiError {
  constructor(message = 'An account with that email address already exists.') {
    super(409, ErrorCode.EMAIL_IN_USE, message);
  }
}

export class RateLimitedError extends ApiError {
  constructor(message = 'Too many attempts. Wait a few minutes and try again.') {
    super(429, ErrorCode.RATE_LIMITED, message);
  }
}

export class PayloadTooLargeError extends ApiError {
  constructor(message = 'That upload is too large.') {
    super(413, ErrorCode.PAYLOAD_TOO_LARGE, message);
  }
}

export class InternalError extends ApiError {
  constructor(message = 'Something went wrong. Please try again.') {
    super(500, ErrorCode.INTERNAL, message);
  }
}
