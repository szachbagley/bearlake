import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequireAdmin } from '../../src/auth/RequireAdmin.tsx';
import * as session from '../../src/auth/session.ts';
import type { PublicUser, SessionResult } from '../../src/types/api.ts';
import { createFakeApiClient, renderWithAuth } from './testUtils.tsx';

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

function loginResult(user: PublicUser): SessionResult {
  return { accessToken: 'a1', refreshToken: 'r1', user };
}

afterEach(() => {
  session.clear();
});

/** RequireAdmin routes via <Navigate>, so the test needs real routes to land
 * on and observe — a bare marker string per destination. */
function Guarded() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <RequireAdmin>
            <div>protected content</div>
          </RequireAdmin>
        }
      />
      <Route path="/login" element={<div>login page</div>} />
      <Route path="/change-password" element={<div>change password page</div>} />
    </Routes>
  );
}

describe('RequireAdmin', () => {
  it('shows a splash while restoring, before redirecting anywhere', () => {
    // No fake resolves during this assertion window — status stays
    // 'restoring' for the moment being checked.
    const client = createFakeApiClient({ refresh: () => new Promise(() => undefined) });
    session.setRefreshToken('token');

    renderWithAuth(<Guarded />, { client });

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('login page')).not.toBeInTheDocument();
  });

  it('redirects to /login when signed out', async () => {
    const client = createFakeApiClient();

    renderWithAuth(<Guarded />, { client });

    await waitFor(() => expect(screen.getByText('login page')).toBeInTheDocument());
  });

  it('redirects to /change-password when the signed-in user must change it', async () => {
    session.setRefreshToken('token');
    const client = createFakeApiClient({
      refresh: () => Promise.resolve(loginResult(adminUser({ mustChangePassword: true }))),
    });

    renderWithAuth(<Guarded />, { client });

    await waitFor(() => expect(screen.getByText('change password page')).toBeInTheDocument());
  });

  it('renders the protected content for a fully signed-in admin', async () => {
    session.setRefreshToken('token');
    const client = createFakeApiClient({
      refresh: () => Promise.resolve(loginResult(adminUser())),
    });

    renderWithAuth(<Guarded />, { client });

    await waitFor(() => expect(screen.getByText('protected content')).toBeInTheDocument());
  });

  it('shows the rejection screen for a non-admin and never renders protected content', async () => {
    session.setRefreshToken('token');
    const client = createFakeApiClient({
      refresh: () => Promise.resolve(loginResult(adminUser({ role: 'member' }))),
      logout: () => Promise.resolve(undefined),
    });

    renderWithAuth(<Guarded />, { client });

    await waitFor(() =>
      expect(screen.getByText('This tool is for family admins')).toBeInTheDocument(),
    );
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('the rejection screen stays up even after the background logout completes', async () => {
    session.setRefreshToken('token');
    let resolveLogout: (() => void) | undefined;
    const client = createFakeApiClient({
      refresh: () => Promise.resolve(loginResult(adminUser({ role: 'member' }))),
      logout: () =>
        new Promise((resolve) => {
          resolveLogout = () => resolve(undefined);
        }),
    });

    renderWithAuth(<Guarded />, { client });

    await waitFor(() =>
      expect(screen.getByText('This tool is for family admins')).toBeInTheDocument(),
    );

    // Completing the background revoke flips AuthProvider's status to
    // 'signed-out' — the rejection screen must not flash away into /login
    // once that happens.
    resolveLogout?.();
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText('This tool is for family admins')).toBeInTheDocument();
    expect(screen.queryByText('login page')).not.toBeInTheDocument();
  });

  it('blocks navigating away from /change-password while mustChangePassword is true, even after interaction', async () => {
    session.setRefreshToken('token');
    const client = createFakeApiClient({
      refresh: () => Promise.resolve(loginResult(adminUser({ mustChangePassword: true }))),
    });
    const user = userEvent.setup();

    renderWithAuth(<Guarded />, { client });

    await waitFor(() => expect(screen.getByText('change password page')).toBeInTheDocument());
    // Nothing on this fake page can navigate away; re-affirm the guard is
    // still redirecting here rather than something having slipped through.
    await user.tab();
    expect(screen.getByText('change password page')).toBeInTheDocument();
  });
});

// Silence the one expected console.error from the deliberately-triggered
// AuthProvider-missing case, matching the pattern used in Phase 1's
// context.test.tsx for the analogous useApiClient case.
describe('useAuth guard', () => {
  it('RequireAdmin throws a clear error when rendered outside AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<RequireAdmin>{null}</RequireAdmin>)).toThrow(
      'useAuth must be used within an AuthProvider.',
    );
    spy.mockRestore();
  });
});
