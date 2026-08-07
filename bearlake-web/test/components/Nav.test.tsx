import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Nav } from '../../src/components/Nav.tsx';
import * as session from '../../src/auth/session.ts';
import type { PublicUser, SessionResult } from '../../src/types/api.ts';
import { createFakeApiClient, renderWithAuth } from '../auth/testUtils.tsx';

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

function signedIn(initialEntries: string[]) {
  session.setRefreshToken('token');
  const client = createFakeApiClient({
    refresh: (): Promise<SessionResult> =>
      Promise.resolve({ accessToken: 'a1', refreshToken: 'r1', user: adminUser() }),
  });
  return renderWithAuth(<Nav />, { client, initialEntries });
}

describe('Nav', () => {
  it("shows the signed-in admin's display name", async () => {
    signedIn(['/announcements']);

    await waitFor(() => expect(screen.getByText('Zach Bagley')).toBeInTheDocument());
  });

  it('marks the current route link active and leaves the others inactive', async () => {
    signedIn(['/quick-tips']);

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Quick tips' })).toHaveClass('nav-link--active'),
    );
    expect(screen.getByRole('link', { name: 'Announcements' })).not.toHaveClass(
      'nav-link--active',
    );
  });
});
