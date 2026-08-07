import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  configureApiClientAuth,
  request,
  type ApiClientAuth,
} from '../../src/api/client.ts';

/**
 * Tests client.ts against a stubbed global fetch (plan W7) — no MSW, no real
 * network. Covers exactly the scenarios named in the plan's Phase 1 test
 * list, including the two timing-sensitive single-flight cases.
 */

interface FakeResponseInit {
  status: number;
  json?: unknown;
  /** Simulates a body that isn't valid JSON (e.g. an HTML error page). */
  invalidJson?: boolean;
}

function fakeResponse({ status, json, invalidJson = false }: FakeResponseInit): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => (invalidJson ? Promise.reject(new SyntaxError('Unexpected token')) : Promise.resolve(json)),
    // Only the members client.ts actually reads are implemented; the rest of
    // the real Response interface is irrelevant to this test double.
  } as unknown as Response;
}

// Typed against fetch's real signature — untyped, vi.fn()'s mock methods
// infer a void-returning callback, which mockImplementation's Promise-
// returning stub then violates.
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  configureApiClientAuth(null);
  vi.unstubAllGlobals();
});

describe('request — success and envelope handling', () => {
  it('parses a successful JSON envelope', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ status: 200, json: { ok: true, n: 3 } }));

    const result = await request<{ ok: boolean; n: number }>('/health');

    expect(result).toEqual({ ok: true, n: 3 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/health');
  });

  it('yields undefined for a 204', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ status: 204 }));

    const result = await request<undefined>('/announcements/1', { method: 'DELETE' });

    expect(result).toBeUndefined();
  });

  it('builds a query string, omitting undefined values', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ status: 200, json: {} }));

    await request('/events', { query: { start: '2026-07-01', end: '2026-08-01', cursor: undefined } });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/events?start=2026-07-01&end=2026-08-01');
  });

  it('sends a JSON body with Content-Type only when there is a body', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ status: 201, json: { id: '1' } }));

    await request('/quick-tips', { method: 'POST', body: { body: 'Gate code 0000' } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ body: 'Gate code 0000' }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});

describe('request — error handling', () => {
  it('maps a server error body to a typed ApiError', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        status: 404,
        json: { error: { code: 'NOT_FOUND', message: 'That item could not be found.' } },
      }),
    );

    await expect(request('/events/unknown')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'That item could not be found.',
    });
  });

  it('falls back to INTERNAL when a 500 body is not valid JSON', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ status: 500, invalidJson: true }));

    const err = await request<never>('/events').catch((e: unknown) => e as ApiError);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
    expect(err.code).toBe('INTERNAL');
  });

  it('falls back to INTERNAL when a non-2xx body is valid JSON but not the error shape', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ status: 500, json: { oops: true } }));

    const err = await request<never>('/events').catch((e: unknown) => e as ApiError);

    expect(err.code).toBe('INTERNAL');
  });

  it('produces a NETWORK_ERROR ApiError when fetch itself throws', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const err = await request<never>('/events').catch((e: unknown) => e as ApiError);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.code).toBe('NETWORK_ERROR');
  });
});

/** A controllable stub: refreshAccessToken() only resolves when the test
 * calls resolveRefresh(), so concurrent-401 timing can be driven precisely. */
function controllableAuth(getToken: () => string): {
  auth: ApiClientAuth;
  refreshCallCount: () => number;
  resolveRefresh: (token: string | null) => void;
} {
  let refreshCallCount = 0;
  let resolvePending: ((token: string | null) => void) | undefined;

  const auth: ApiClientAuth = {
    getAccessToken: () => getToken(),
    refreshAccessToken: () =>
      new Promise((resolve) => {
        refreshCallCount += 1;
        resolvePending = resolve;
      }),
  };

  return {
    auth,
    refreshCallCount: () => refreshCallCount,
    resolveRefresh: (token) => {
      if (resolvePending === undefined) {
        throw new Error('refreshAccessToken was not called yet');
      }
      resolvePending(token);
      resolvePending = undefined;
    },
  };
}

describe('request — 401 refresh and retry (plan W28)', () => {
  it('refreshes once and retries once on a single 401', async () => {
    let currentToken = 'old-token';
    const { auth, refreshCallCount, resolveRefresh } = controllableAuth(() => currentToken);
    configureApiClientAuth(auth);

    fetchMock
      .mockResolvedValueOnce(fakeResponse({ status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'x' } } }))
      .mockResolvedValueOnce(fakeResponse({ status: 200, json: { ok: true } }));

    const pending = request<{ ok: boolean }>('/me');

    // Let the 401 branch reach and call refreshAccessToken.
    await vi.waitFor(() => expect(refreshCallCount()).toBe(1));
    currentToken = 'new-token';
    resolveRefresh('new-token');

    const result = await pending;

    expect(result).toEqual({ ok: true });
    expect(refreshCallCount()).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, retryInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((retryInit.headers as Record<string, string>)['Authorization']).toBe('Bearer new-token');
  });

  it('two concurrent 401s trigger exactly one refresh call', async () => {
    let currentToken = 'old-token';
    const { auth, refreshCallCount, resolveRefresh } = controllableAuth(() => currentToken);
    configureApiClientAuth(auth);

    fetchMock.mockImplementation((_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      const bearer = headers?.['Authorization'];
      if (bearer === 'Bearer new-token') {
        return Promise.resolve(fakeResponse({ status: 200, json: {} }));
      }
      return Promise.resolve(
        fakeResponse({ status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'x' } } }),
      );
    });

    // Fired without awaiting either first, so both requests' 401 branches
    // are in flight before the refresh resolves — the real race this
    // dedup logic exists for.
    const first = request('/me');
    const second = request('/users');

    await vi.waitFor(() => expect(refreshCallCount()).toBe(1));
    currentToken = 'new-token';
    resolveRefresh('new-token');

    await Promise.all([first, second]);

    expect(refreshCallCount()).toBe(1);
    // Each original request plus exactly one retry each: 4, not 3 or 5.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not retry when refresh fails, and reports the original 401', async () => {
    const { auth, refreshCallCount, resolveRefresh } = controllableAuth(() => 'old-token');
    configureApiClientAuth(auth);

    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        status: 401,
        json: { error: { code: 'UNAUTHENTICATED', message: 'Your session has expired.' } },
      }),
    );

    const pending = request('/me');
    await vi.waitFor(() => expect(refreshCallCount()).toBe(1));
    resolveRefresh(null);

    await expect(pending).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'Your session has expired.',
    });
    expect(refreshCallCount()).toBe(1);
    // No retry attempt: only the one original call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not attempt to refresh when skipAuth is set (login, refresh)', async () => {
    const { auth, refreshCallCount } = controllableAuth(() => 'old-token');
    configureApiClientAuth(auth);

    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        status: 401,
        json: { error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password.' } },
      }),
    );

    await expect(request('/auth/login', { method: 'POST', skipAuth: true })).rejects.toMatchObject(
      { code: 'INVALID_CREDENTIALS' },
    );
    expect(refreshCallCount()).toBe(0);
  });

  it('does not send an Authorization header when no auth is configured', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ status: 200, json: {} }));

    await request('/announcements');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });
});
