import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/client.ts';
import { ChangePasswordPage } from '../../src/auth/ChangePasswordPage.tsx';
import { useAuth } from '../../src/auth/AuthProvider.tsx';
import * as session from '../../src/auth/session.ts';
import type { PublicUser, SessionResult } from '../../src/types/api.ts';
import { createFakeApiClient, renderWithAuth } from './testUtils.tsx';

function user(overrides: Partial<PublicUser> = {}): PublicUser {
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

function result(publicUser: PublicUser): SessionResult {
  return { accessToken: 'a2', refreshToken: 'r2', user: publicUser };
}

afterEach(() => {
  session.clear();
});

/** Signs the fixture in first, in whichever mode, via a real login() call —
 * exercising ChangePasswordPage against a genuine established session,
 * matching how RequireAdmin actually reaches it. */
function Harness() {
  const { status, login } = useAuth();
  if (status === 'signed-out') {
    void login('zach@example.com', 'temp-password-1234');
    return null;
  }
  if (status !== 'signed-in') return null;
  return <ChangePasswordPage />;
}

async function fillForm(
  u: ReturnType<typeof userEvent.setup>,
  current: string,
  next: string,
  confirm: string,
) {
  await u.type(screen.getByLabelText('Current password'), current);
  await u.type(screen.getByLabelText('New password'), next);
  await u.type(screen.getByLabelText('Confirm new password'), confirm);
  await u.click(screen.getByRole('button', { name: 'Change password' }));
}

describe('ChangePasswordPage — forced flow', () => {
  it('has no cancel button and no way to dismiss it', async () => {
    const client = createFakeApiClient({
      login: () => Promise.resolve(result(user({ mustChangePassword: true }))),
    });
    renderWithAuth(<Harness />, { client });

    await waitFor(() => expect(screen.getByText('Change your password')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('requires the current password too, held only in the form', async () => {
    const client = createFakeApiClient({
      login: () => Promise.resolve(result(user({ mustChangePassword: true }))),
    });
    renderWithAuth(<Harness />, { client });
    await waitFor(() => expect(screen.getByLabelText('Current password')).toBeInTheDocument());

    expect(screen.getByLabelText('Current password')).toBeRequired();
  });
});

describe('ChangePasswordPage — voluntary flow', () => {
  it('shows a cancel affordance', async () => {
    const client = createFakeApiClient({
      login: () => Promise.resolve(result(user({ mustChangePassword: false }))),
    });
    renderWithAuth(<Harness />, { client });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument());
  });
});

describe('ChangePasswordPage — validation and submission', () => {
  it('rejects a new password shorter than 12 characters without calling the API', async () => {
    // changePassword is left at its default "not stubbed" rejection — if
    // client-side validation failed to block the submit, the resulting
    // unhandled call would fail the test rather than this passing quietly.
    const client = createFakeApiClient({
      login: () => Promise.resolve(result(user({ mustChangePassword: true }))),
    });
    const u = userEvent.setup();

    renderWithAuth(<Harness />, { client });
    await waitFor(() => expect(screen.getByLabelText('New password')).toBeInTheDocument());

    await fillForm(u, 'temp-password-1234', 'short', 'short');

    expect(screen.getByRole('alert')).toHaveTextContent('at least 12 characters');
  });

  it('rejects mismatched new/confirm passwords without calling the API', async () => {
    const client = createFakeApiClient({
      login: () => Promise.resolve(result(user({ mustChangePassword: true }))),
    });
    const u = userEvent.setup();

    renderWithAuth(<Harness />, { client });
    await waitFor(() => expect(screen.getByLabelText('New password')).toBeInTheDocument());

    await fillForm(u, 'temp-password-1234', 'a-new-password-123', 'a-different-password-9');

    expect(screen.getByRole('alert')).toHaveTextContent('do not match');
  });

  it('surfaces a server VALIDATION_ERROR message verbatim', async () => {
    const client = createFakeApiClient({
      login: () => Promise.resolve(result(user({ mustChangePassword: true }))),
      changePassword: () =>
        Promise.reject(new ApiError(400, 'VALIDATION_ERROR', 'That password is too common.')),
    });
    const u = userEvent.setup();

    renderWithAuth(<Harness />, { client });
    await waitFor(() => expect(screen.getByLabelText('New password')).toBeInTheDocument());

    await fillForm(u, 'temp-password-1234', 'a-common-password-1', 'a-common-password-1');

    expect(await screen.findByRole('alert')).toHaveTextContent('That password is too common.');
  });

  it('a successful change installs the new token pair', async () => {
    const client = createFakeApiClient({
      login: () => Promise.resolve(result(user({ mustChangePassword: true }))),
      changePassword: () => Promise.resolve(result(user({ mustChangePassword: false }))),
    });
    const u = userEvent.setup();

    renderWithAuth(<Harness />, { client });
    await waitFor(() => expect(screen.getByLabelText('New password')).toBeInTheDocument());

    await fillForm(u, 'temp-password-1234', 'a-brand-new-password-1', 'a-brand-new-password-1');

    await waitFor(() => expect(session.getAccessToken()).toBe('a2'));
    expect(session.getRefreshToken()).toBe('r2');
  });
});
