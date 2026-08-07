import { z } from 'zod';
import { getConfig } from '../config.ts';
import { NETWORK_ERROR_CODE } from '../types/api.ts';

/**
 * The one HTTP wrapper every endpoint function goes through (plan step 5).
 *
 * `code` is deliberately `string`, not the KnownErrorCode union: an
 * unrecognized code must still carry the server's real, display-safe
 * message (plan W13) rather than being coerced into a generic failure.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

const errorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

/**
 * Wired in by auth/session.ts at startup (Phase 2). Kept as an injected
 * interface, not an import, so this module and auth/session.ts never form a
 * circular dependency (plan step 5) — session.ts needs the client to call
 * /auth/refresh; the client needs session.ts's token and refresh logic.
 */
export interface ApiClientAuth {
  /** The current access token, or null when signed out. */
  getAccessToken: () => string | null;
  /**
   * Attempts a refresh. Resolves to the new access token on success, or null
   * on failure. Must not itself call `request()` in a way that could 401 and
   * recurse — plan W28 treats a failed refresh as final, never retried.
   */
  refreshAccessToken: () => Promise<string | null>;
  /**
   * Called on any 403 PASSWORD_CHANGE_REQUIRED, from any call (plan step 7).
   * The server checks `mustChangePassword` fresh on every request, which can
   * disagree with the client's last-known user object — this lets
   * AuthProvider update its own state so the gate applies immediately,
   * rather than leaving a raw error on whatever page happened to hit it.
   */
  onPasswordChangeRequired?: () => void;
}

let auth: ApiClientAuth | null = null;

export function configureApiClientAuth(next: ApiClientAuth | null): void {
  auth = next;
}

/** Deduplicates concurrent 401s onto one in-flight refresh (plan W28). */
let refreshPromise: Promise<string | null> | null = null;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  // `| undefined` is explicit, not redundant: exactOptionalPropertyTypes
  // distinguishes "key absent" from "key present with value undefined," and
  // every caller here forwards an already-optional field (e.g. RequestSignal
  // in endpoints.ts), which is legitimately one or the other.
  signal?: AbortSignal | undefined;
  /**
   * Skips bearer injection and the 401 refresh-and-retry cycle. Used only by
   * login and refresh: login has no token yet, and refresh IS the recovery
   * mechanism, so it must never try to recover from its own 401.
   */
  skipAuth?: boolean;
}

function buildUrl(path: string, query: RequestOptions['query']): string {
  const url = `${getConfig().apiBaseUrl}${path}`;
  if (query === undefined) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs === '' ? url : `${url}?${qs}`;
}

async function toApiError(response: Response): Promise<ApiError> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return new ApiError(response.status, 'INTERNAL', GENERIC_ERROR_MESSAGE);
  }

  const parsed = errorBodySchema.safeParse(raw);
  if (!parsed.success) {
    return new ApiError(response.status, 'INTERNAL', GENERIC_ERROR_MESSAGE);
  }

  return new ApiError(response.status, parsed.data.error.code, parsed.data.error.message);
}

/**
 * The one place a 401 is turned into a single-flight refresh-and-retry.
 * Takes the already-null-checked auth object as a parameter rather than
 * re-reading the module-level `auth` — TypeScript cannot carry a null check
 * on mutable module state across a function boundary, and passing the
 * narrowed value in is cleaner than re-asserting it here.
 */
async function recoverFrom401(currentAuth: ApiClientAuth): Promise<string | null> {
  refreshPromise ??= currentAuth.refreshAccessToken().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function performRequest<T>(
  path: string,
  options: RequestOptions,
  isRetry: boolean,
): Promise<T> {
  const { method = 'GET', body, query, signal, skipAuth = false } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (!skipAuth && auth !== null) {
    const token = auth.getAccessToken();
    if (token !== null) headers['Authorization'] = `Bearer ${token}`;
  }

  // Built conditionally, not with `body: body && JSON.stringify(body)`: DOM's
  // RequestInit does not accept an explicit `undefined` for these under
  // exactOptionalPropertyTypes (only omission or a real value), and that
  // constraint is correct here — the same signal it flags is real: a GET
  // must never send a body key at all, not a body key set to undefined.
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (signal !== undefined) init.signal = signal;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), init);
  } catch {
    // Includes deliberate aborts (AbortError) as well as genuine network
    // failures; useQuery's cancelled-flag guard is what keeps an aborted
    // request from setting state on an unmounted component either way.
    throw new ApiError(
      0,
      NETWORK_ERROR_CODE,
      'Could not reach the server. Check your connection and try again.',
    );
  }

  if (response.status === 401 && !skipAuth && auth !== null && !isRetry) {
    const newToken = await recoverFrom401(auth);
    if (newToken !== null) {
      return performRequest<T>(path, options, true);
    }
    // Refresh failed: fall through and report the original 401 below.
  }

  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    const apiError = await toApiError(response);
    if (apiError.code === 'PASSWORD_CHANGE_REQUIRED') {
      auth?.onPasswordChangeRequired?.();
    }
    throw apiError;
  }

  // Response.json() is typed `any` by lib.dom; this is the one place that
  // untyped external boundary becomes the caller's declared type.
  return (await response.json()) as T;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return performRequest<T>(path, options, false);
}
