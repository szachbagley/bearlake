import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/client.ts';
import { LoginPage } from '../../src/auth/LoginPage.tsx';
import * as session from '../../src/auth/session.ts';
import type { PublicUser, SessionResult } from '../../src/types/api.ts';
import { createFakeApiClient, renderWithAuth } from './testUtils.tsx';

function adminUser(): PublicUser {
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
  };
}

function loginResult(): SessionResult {
  return { accessToken: 'a1', refreshToken: 'r1', user: adminUser() };
}

afterEach(() => {
  session.clear();
});

function Page() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<div>landed on the app</div>} />
    </Routes>
  );
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, email: string, password: string) {
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('LoginPage', () => {
  it('successful login lands on the app', async () => {
    const client = createFakeApiClient({ login: () => Promise.resolve(loginResult()) });
    const user = userEvent.setup();

    renderWithAuth(<Page />, { client, initialEntries: ['/login'] });

    await fillAndSubmit(user, 'zach@example.com', 'correct-password-1234');

    await waitFor(() => expect(screen.getByText('landed on the app')).toBeInTheDocument());
  });

  it('shows one generic message regardless of the failure cause', async () => {
    const client = createFakeApiClient({
      login: () => Promise.reject(new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.')),
    });
    const user = userEvent.setup();

    renderWithAuth(<Page />, { client, initialEntries: ['/login'] });
    await fillAndSubmit(user, 'zach@example.com', 'wrong-password-1234');

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
  });

  it('shows the server message specifically for RATE_LIMITED', async () => {
    const client = createFakeApiClient({
      login: () =>
        Promise.reject(
          new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a few minutes and try again.'),
        ),
    });
    const user = userEvent.setup();

    renderWithAuth(<Page />, { client, initialEntries: ['/login'] });
    await fillAndSubmit(user, 'zach@example.com', 'wrong-password-1234');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Wait a few minutes and try again.',
    );
  });

  it('shows the same generic message for an unexpected non-ApiError failure', async () => {
    const client = createFakeApiClient({
      login: () => Promise.reject(new Error('network exploded')),
    });
    const user = userEvent.setup();

    renderWithAuth(<Page />, { client, initialEntries: ['/login'] });
    await fillAndSubmit(user, 'zach@example.com', 'wrong-password-1234');

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
  });

  it('stores nothing on failure', async () => {
    const client = createFakeApiClient({
      login: () => Promise.reject(new ApiError(401, 'INVALID_CREDENTIALS', 'x')),
    });
    const user = userEvent.setup();

    renderWithAuth(<Page />, { client, initialEntries: ['/login'] });
    await fillAndSubmit(user, 'zach@example.com', 'wrong-password-1234');

    await screen.findByRole('alert');
    expect(session.getAccessToken()).toBeNull();
    expect(session.getRefreshToken()).toBeNull();
  });

  it('has no create-account or forgot-password affordance', () => {
    const client = createFakeApiClient();
    renderWithAuth(<Page />, { client, initialEntries: ['/login'] });

    expect(screen.queryByRole('link', { name: /create account/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /forgot/i })).not.toBeInTheDocument();
    expect(screen.getByText(/contact a family admin/i)).toBeInTheDocument();
  });

  it('disables the submit button while a login is in flight', async () => {
    const client = createFakeApiClient({
      login: () => new Promise((resolve) => setTimeout(() => resolve(loginResult()), 20)),
    });
    const user = userEvent.setup();

    renderWithAuth(<Page />, { client, initialEntries: ['/login'] });
    await user.type(screen.getByLabelText('Email'), 'zach@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct-password-1234');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    await waitFor(() => expect(screen.getByText('landed on the app')).toBeInTheDocument());
  });
});
