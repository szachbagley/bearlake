import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/client.ts';
import * as session from '../../../src/auth/session.ts';
import { UsersPage } from '../../../src/features/users/UsersPage.tsx';
import type { PublicUser, SessionResult } from '../../../src/types/api.ts';
import { createFakeApiClient, renderWithAuth } from '../../auth/testUtils.tsx';

function user(overrides: Partial<PublicUser> = {}): PublicUser {
  return {
    id: 'u1',
    displayName: 'Brit Bagley',
    email: 'brit@example.com',
    role: 'member',
    mustChangePassword: false,
    isActive: true,
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const currentAdmin = user({
  id: 'admin1',
  displayName: 'Zach Bagley',
  email: 'zach@example.com',
  role: 'admin',
});

/** Establishes a signed-in admin session (AuthProvider populates
 * `currentUser`, which UsersPage needs for self-row detection) and stubs
 * `listUsers` on top of that same fake client. */
function renderUsersPage(overrides: Parameters<typeof createFakeApiClient>[0] = {}) {
  session.setRefreshToken('token');
  const client = createFakeApiClient({
    refresh: (): Promise<SessionResult> =>
      Promise.resolve({ accessToken: 'a1', refreshToken: 'r1', user: currentAdmin }),
    listUsers: () => Promise.resolve({ users: [currentAdmin] }),
    ...overrides,
  });
  return { client, ...renderWithAuth(<UsersPage />, { client }) };
}

afterEach(() => {
  session.clear();
  vi.unstubAllGlobals();
});

function row(displayName: string): HTMLElement {
  const cell = screen.getByText(displayName, { exact: false });
  const tr = cell.closest('tr');
  if (tr === null) throw new Error(`no <tr> ancestor for "${displayName}"`);
  return tr;
}

describe('UsersPage', () => {
  it('renders the table with deactivated users visually distinct', async () => {
    const inactive = user({ id: 'u2', displayName: 'Old Member', isActive: false });
    renderUsersPage({ listUsers: () => Promise.resolve({ users: [currentAdmin, inactive] }) });

    await waitFor(() => expect(screen.getByText('Old Member')).toBeInTheDocument());
    expect(within(row('Old Member')).getByText('Deactivated')).toBeInTheDocument();
    expect(row('Old Member')).toHaveStyle({ opacity: '0.55' });
    expect(row('Zach Bagley')).not.toHaveStyle({ opacity: '0.55' });
  });

  it("creates a user, shows the temp password exactly once, and clears it on dismiss", async () => {
    const created = user({ id: 'u3', displayName: 'New Person', email: 'new@example.com' });
    const listUsers = vi
      .fn()
      .mockResolvedValueOnce({ users: [currentAdmin] })
      .mockResolvedValueOnce({ users: [currentAdmin, created] });
    const createUser = vi
      .fn()
      .mockResolvedValue({ user: created, temporaryPassword: 'temp-Pass-1234' });
    const { client } = renderUsersPage({ listUsers, createUser });
    const user_ = userEvent.setup();

    await waitFor(() => expect(screen.getByText('Zach Bagley', { exact: false })).toBeInTheDocument());
    await user_.click(screen.getByRole('button', { name: 'New user' }));
    await user_.type(screen.getByLabelText('Display name'), 'New Person');
    await user_.type(screen.getByLabelText('Email'), 'new@example.com');
    await user_.click(screen.getByRole('button', { name: 'Create user' }));

    expect(client.createUser).toHaveBeenCalledExactlyOnceWith({
      displayName: 'New Person',
      email: 'new@example.com',
      role: 'member',
    });
    expect(await screen.findByText('temp-Pass-1234')).toBeInTheDocument();
    expect(screen.getByText(/will not be shown again/)).toBeInTheDocument();

    await user_.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('temp-Pass-1234')).not.toBeInTheDocument();
  });

  it('never writes the temp password to sessionStorage, localStorage, the URL, or console', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const createUser = vi
      .fn()
      .mockResolvedValue({ user: user({ id: 'u3' }), temporaryPassword: 'super-secret-temp' });
    const { client } = renderUsersPage({ createUser });
    const user_ = userEvent.setup();

    await waitFor(() => expect(screen.getByText('Zach Bagley', { exact: false })).toBeInTheDocument());
    await user_.click(screen.getByRole('button', { name: 'New user' }));
    await user_.type(screen.getByLabelText('Display name'), 'Someone');
    await user_.type(screen.getByLabelText('Email'), 'someone@example.com');
    await user_.click(screen.getByRole('button', { name: 'Create user' }));

    expect(await screen.findByText('super-secret-temp')).toBeInTheDocument();

    expect(window.sessionStorage.getItem('super-secret-temp')).toBeNull();
    expect(Object.values(window.sessionStorage).join(' ')).not.toContain('super-secret-temp');
    expect(window.location.href).not.toContain('super-secret-temp');
    for (const call of consoleSpy.mock.calls.flat()) {
      expect(String(call)).not.toContain('super-secret-temp');
    }
    for (const call of errorSpy.mock.calls.flat()) {
      expect(String(call)).not.toContain('super-secret-temp');
    }

    expect(client.createUser).toHaveBeenCalledOnce();
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('copy button copies the exact temp password', async () => {
    // user-event's own setup() installs a clipboard mock of its own — it
    // must run first, or vi.stubGlobal's replacement gets clobbered by it.
    const user_ = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const createUser = vi
      .fn()
      .mockResolvedValue({ user: user({ id: 'u3' }), temporaryPassword: 'copy-me-exactly' });
    renderUsersPage({ createUser });

    await waitFor(() => expect(screen.getByText('Zach Bagley', { exact: false })).toBeInTheDocument());
    await user_.click(screen.getByRole('button', { name: 'New user' }));
    await user_.type(screen.getByLabelText('Display name'), 'Someone');
    await user_.type(screen.getByLabelText('Email'), 'someone@example.com');
    await user_.click(screen.getByRole('button', { name: 'Create user' }));
    await screen.findByText('copy-me-exactly');

    await user_.click(screen.getByRole('button', { name: 'Copy password' }));

    expect(writeText).toHaveBeenCalledExactlyOnceWith('copy-me-exactly');
  });

  it("disables the role and active controls on the current admin's own row", async () => {
    renderUsersPage();
    const user_ = userEvent.setup();

    await waitFor(() => expect(screen.getByText('Zach Bagley', { exact: false })).toBeInTheDocument());
    await user_.click(within(row('Zach Bagley')).getByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText('Role')).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('leaves role and active enabled when editing a different user', async () => {
    const other = user({ id: 'u2', displayName: 'Other Person' });
    renderUsersPage({ listUsers: () => Promise.resolve({ users: [currentAdmin, other] }) });
    const user_ = userEvent.setup();

    await waitFor(() => expect(screen.getByText('Other Person')).toBeInTheDocument());
    await user_.click(within(row('Other Person')).getByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText('Role')).toBeEnabled();
    expect(screen.getByRole('checkbox')).toBeEnabled();
  });

  it('deactivating a user requires confirmation, and canceling reverts the toggle', async () => {
    const other = user({ id: 'u2', displayName: 'Other Person' });
    const updateUser = vi.fn().mockResolvedValue({ ...other, isActive: false });
    renderUsersPage({
      listUsers: () => Promise.resolve({ users: [currentAdmin, other] }),
      updateUser,
    });
    const user_ = userEvent.setup();

    await waitFor(() => expect(screen.getByText('Other Person')).toBeInTheDocument());
    await user_.click(within(row('Other Person')).getByRole('button', { name: 'Edit' }));
    await user_.click(screen.getByRole('checkbox'));
    await user_.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Deactivate this user?')).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();

    await user_.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('deactivating a user calls updateUser with { isActive: false } after confirming', async () => {
    const other = user({ id: 'u2', displayName: 'Other Person' });
    const updateUser = vi.fn().mockResolvedValue({ ...other, isActive: false });
    renderUsersPage({
      listUsers: () => Promise.resolve({ users: [currentAdmin, other] }),
      updateUser,
    });
    const user_ = userEvent.setup();

    await waitFor(() => expect(screen.getByText('Other Person')).toBeInTheDocument());
    await user_.click(within(row('Other Person')).getByRole('button', { name: 'Edit' }));
    await user_.click(screen.getByRole('checkbox'));
    await user_.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Deactivate this user?');

    const dialog = screen.getByRole('dialog');
    await user_.click(within(dialog).getByRole('button', { name: 'Deactivate' }));

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledExactlyOnceWith('u2', { isActive: false }),
    );
  });

  it('reactivating a deactivated user needs no confirmation', async () => {
    const other = user({ id: 'u2', displayName: 'Other Person', isActive: false });
    const updateUser = vi.fn().mockResolvedValue({ ...other, isActive: true });
    renderUsersPage({
      listUsers: () => Promise.resolve({ users: [currentAdmin, other] }),
      updateUser,
    });
    const user_ = userEvent.setup();

    await waitFor(() => expect(screen.getByText('Other Person')).toBeInTheDocument());
    await user_.click(within(row('Other Person')).getByRole('button', { name: 'Edit' }));
    await user_.click(screen.getByRole('checkbox'));
    await user_.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.queryByText('Deactivate this user?')).not.toBeInTheDocument();
    await waitFor(() => expect(updateUser).toHaveBeenCalledExactlyOnceWith('u2', { isActive: true }));
  });

  it('resetting a password requires confirmation before calling the API', async () => {
    const other = user({ id: 'u2', displayName: 'Other Person' });
    const resetUserPassword = vi.fn().mockResolvedValue({ temporaryPassword: 'reset-temp-pass' });
    renderUsersPage({
      listUsers: () => Promise.resolve({ users: [currentAdmin, other] }),
      resetUserPassword,
    });
    const user_ = userEvent.setup();

    await waitFor(() => expect(screen.getByText('Other Person')).toBeInTheDocument());
    await user_.click(within(row('Other Person')).getByRole('button', { name: 'Reset password' }));
    await user_.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(resetUserPassword).not.toHaveBeenCalled();

    await user_.click(within(row('Other Person')).getByRole('button', { name: 'Reset password' }));
    const dialog = screen.getByRole('dialog');
    await user_.click(within(dialog).getByRole('button', { name: 'Reset password' }));

    await waitFor(() => expect(resetUserPassword).toHaveBeenCalledExactlyOnceWith('u2'));
    expect(await screen.findByText('reset-temp-pass')).toBeInTheDocument();
  });

  it('EMAIL_IN_USE maps to the email field, not a generic banner', async () => {
    const createUser = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'EMAIL_IN_USE', 'That email is already in use.'));
    renderUsersPage({ createUser });
    const user_ = userEvent.setup();

    await waitFor(() => expect(screen.getByText('Zach Bagley', { exact: false })).toBeInTheDocument());
    await user_.click(screen.getByRole('button', { name: 'New user' }));
    await user_.type(screen.getByLabelText('Display name'), 'Dup');
    await user_.type(screen.getByLabelText('Email'), 'zach@example.com');
    await user_.click(screen.getByRole('button', { name: 'Create user' }));

    const emailField = screen.getByLabelText('Email').closest('div');
    if (emailField === null) throw new Error('email field wrapper not found');
    await waitFor(() =>
      expect(within(emailField).getByText('That email is already in use.')).toBeInTheDocument(),
    );
    // Field-scoped (plan step 6), not a generic banner: only one instance of
    // the message exists, and it isn't inside an .error-banner element.
    expect(screen.getAllByText('That email is already in use.')).toHaveLength(1);
    expect(
      screen.getByText('That email is already in use.').closest('.error-banner'),
    ).toBeNull();
  });
});
