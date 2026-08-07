import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from '../../src/api/client.ts';
import { ApiClientProvider } from '../../src/api/context.tsx';
import { AuthProvider, useAuth } from '../../src/auth/AuthProvider.tsx';
import * as session from '../../src/auth/session.ts';
import type { PublicUser, SessionResult } from '../../src/types/api.ts';
import { createFakeApiClient } from './testUtils.tsx';

/**
 * Exercises AuthProvider directly through its context (plan step 2), rather
 * than through the pages that will eventually sit on top of it — the pages
 * have their own tests for their own concerns (form validation, error copy).
 */

function adminUser(overrides: Partial<PublicUser> = {}): PublicUser {
  return {
    id: 'u1',
    displayName: 'Zach Bagley',
    email: 'zach@example.com',
    role: 'admin',
    mustChangePassword: false,
    isActive: true,
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function session1(user: PublicUser, overrides: Partial<SessionResult> = {}): SessionResult {
  return { accessToken: 'access-1', refreshToken: 'refresh-1', user, ...overrides };
}

function AuthProbe() {
  const { status, user, login, logout, changePassword } = useAuth();
  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="mustChangePassword">{String(user?.mustChangePassword)}</div>
      <div data-testid="role">{user?.role ?? 'none'}</div>
      {/* .catch here mirrors a real page's try/catch around login() — this
       * probe only asserts on state transitions, not on error display. */}
      <button onClick={() => void login('zach@example.com', 'correct-password').catch(() => undefined)}>
        login
      </button>
      <button onClick={() => void logout()}>logout</button>
      <button
        onClick={() => void changePassword('temp-password-1234', 'new-password-1234')}
      >
        changePassword
      </button>
    </div>
  );
}

afterEach(() => {
  session.clear();
});

describe('login', () => {
  it('success stores tokens and lands on signed-in', async () => {
    const client = createFakeApiClient({
      login: () => Promise.resolve(session1(adminUser())),
    });
    const user = userEvent.setup();

    render(
      <ApiClientProvider client={client}>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </ApiClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    await user.click(screen.getByRole('button', { name: 'login' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    expect(session.getAccessToken()).toBe('access-1');
    expect(session.getRefreshToken()).toBe('refresh-1');
  });

  it('failure stores nothing', async () => {
    const client = createFakeApiClient({
      login: () => Promise.reject(new Error('Incorrect email or password.')),
    });
    const user = userEvent.setup();

    render(
      <ApiClientProvider client={client}>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </ApiClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    await user.click(screen.getByRole('button', { name: 'login' }));

    // The rejection propagates to the caller (LoginPage's own concern); here
    // it just needs to confirm nothing got stored as a side effect.
    await waitFor(() => expect(session.getAccessToken()).toBeNull());
    expect(session.getRefreshToken()).toBeNull();
    expect(screen.getByTestId('status')).toHaveTextContent('signed-out');
  });

  it('a member login is rejected and logout is called', async () => {
    const logoutSpy = vi.fn(() => Promise.resolve(undefined));
    const client = createFakeApiClient({
      login: () => Promise.resolve(session1(adminUser({ role: 'member' }))),
      logout: logoutSpy,
    });
    const user = userEvent.setup();

    render(
      <ApiClientProvider client={client}>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </ApiClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    await user.click(screen.getByRole('button', { name: 'login' }));

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('rejected-non-admin'),
    );
    await waitFor(() => expect(logoutSpy).toHaveBeenCalledWith({ refreshToken: 'refresh-1' }));
    // The session is revoked locally too, not just server-side.
    await waitFor(() => expect(session.getRefreshToken()).toBeNull());
  });

  it('a mustChangePassword session lands on signed-in with the flag set, for RequireAdmin to gate', async () => {
    const client = createFakeApiClient({
      login: () => Promise.resolve(session1(adminUser({ mustChangePassword: true }))),
    });
    const user = userEvent.setup();

    render(
      <ApiClientProvider client={client}>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </ApiClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    await user.click(screen.getByRole('button', { name: 'login' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    expect(screen.getByTestId('mustChangePassword')).toHaveTextContent('true');
  });
});

describe('changePassword', () => {
  it('a successful change clears the gate and installs the new token pair', async () => {
    const client = createFakeApiClient({
      login: () => Promise.resolve(session1(adminUser({ mustChangePassword: true }))),
      changePassword: () =>
        Promise.resolve(session1(adminUser({ mustChangePassword: false }), {
          accessToken: 'access-2',
          refreshToken: 'refresh-2',
        })),
    });
    const user = userEvent.setup();

    render(
      <ApiClientProvider client={client}>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </ApiClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    await user.click(screen.getByRole('button', { name: 'login' }));
    await waitFor(() => expect(screen.getByTestId('mustChangePassword')).toHaveTextContent('true'));

    await user.click(screen.getByRole('button', { name: 'changePassword' }));

    await waitFor(() =>
      expect(screen.getByTestId('mustChangePassword')).toHaveTextContent('false'),
    );
    expect(screen.getByTestId('status')).toHaveTextContent('signed-in');
    expect(session.getAccessToken()).toBe('access-2');
    expect(session.getRefreshToken()).toBe('refresh-2');
  });
});

describe('boot restore', () => {
  it('a valid stored refresh token yields a signed-in app', async () => {
    session.setRefreshToken('stored-refresh-token');
    const client = createFakeApiClient({
      refresh: () => Promise.resolve(session1(adminUser(), { refreshToken: 'rotated-refresh' })),
    });

    render(
      <ApiClientProvider client={client}>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </ApiClientProvider>,
    );

    expect(screen.getByTestId('status')).toHaveTextContent('restoring');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    expect(session.getRefreshToken()).toBe('rotated-refresh');
  });

  it('a rejected stored refresh token lands on signed-out with sessionStorage cleared', async () => {
    session.setRefreshToken('stale-refresh-token');
    const client = createFakeApiClient({
      refresh: () => Promise.reject(new Error('Your session has expired.')),
    });

    render(
      <ApiClientProvider client={client}>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </ApiClientProvider>,
    );

    expect(screen.getByTestId('status')).toHaveTextContent('restoring');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    expect(session.getRefreshToken()).toBeNull();
    expect(session.getAccessToken()).toBeNull();
  });

  it('no stored refresh token goes straight to signed-out', async () => {
    const client = createFakeApiClient();

    render(
      <ApiClientProvider client={client}>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </ApiClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
  });
});

describe('wiring into api/client.ts', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  function fakeFetchResponse(init: { status: number; json?: unknown }): Response {
    return {
      status: init.status,
      ok: init.status >= 200 && init.status < 300,
      json: () => Promise.resolve(init.json),
    } as unknown as Response;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a live 401 during normal use refreshes through the real client and updates storage', async () => {
    session.setRefreshToken('stored-refresh-token');
    const client = createFakeApiClient({
      refresh: () => Promise.resolve(session1(adminUser(), { accessToken: 'access-2', refreshToken: 'refresh-2' })),
    });

    render(
      <ApiClientProvider client={client}>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </ApiClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));

    // Now exercise the REAL client.ts wiring: configureApiClientAuth was
    // registered by AuthProvider above, so a genuine 401-then-200 sequence
    // through request() proves the callback it wired actually works, not
    // just that AuthProvider's own state looks right in isolation.
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(fakeFetchResponse({ status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'x' } } }))
      .mockResolvedValueOnce(fakeFetchResponse({ status: 200, json: { ok: true } }));

    const result = await request<{ ok: boolean }>('/some/protected/route');

    expect(result).toEqual({ ok: true });
    expect(session.getAccessToken()).toBe('access-2');
    expect(session.getRefreshToken()).toBe('refresh-2');
  });
});
