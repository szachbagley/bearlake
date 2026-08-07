import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { ApiClientProvider, type ApiClient } from '../../src/api/context.tsx';
import { AuthProvider } from '../../src/auth/AuthProvider.tsx';

/**
 * Shared auth-test scaffolding: a fully-typed fake API client (every
 * endpoint stubbed, so an un-overridden call fails loudly rather than
 * silently hitting the real network) and a render helper wrapping the
 * provider stack tests need (plan W7 — inject a fake client, not MSW).
 */

function notImplemented(name: string) {
  return (..._args: unknown[]): Promise<never> =>
    Promise.reject(new Error(`fake API client: "${name}" was not stubbed for this test`));
}

const ENDPOINT_NAMES = [
  'login',
  'refresh',
  'logout',
  'changePassword',
  'me',
  'listUsers',
  'createUser',
  'updateUser',
  'resetUserPassword',
  'listEvents',
  'createEvent',
  'getEvent',
  'updateEvent',
  'deleteEvent',
  'listAnnouncements',
  'createAnnouncement',
  'updateAnnouncement',
  'deleteAnnouncement',
  'listQuickTips',
  'createQuickTip',
  'updateQuickTip',
  'deleteQuickTip',
  'listCategories',
  'createCategory',
  'updateCategory',
  'deleteCategory',
  'listArticlesByCategory',
  'getArticle',
  'createArticle',
  'updateArticle',
  'deleteArticle',
  'presignUpload',
] as const satisfies readonly (keyof ApiClient)[];

/**
 * Every endpoint rejects by default. Structural typing makes this sound: a
 * `(...args: unknown[]) => Promise<never>` is assignable to any narrower
 * `(specific args) => Promise<SpecificResult>` — it accepts anything, and
 * `never` is a subtype of every result type.
 */
function fullyStubbedClient(): ApiClient {
  const stub = {} as Record<(typeof ENDPOINT_NAMES)[number], (...args: unknown[]) => Promise<never>>;
  for (const name of ENDPOINT_NAMES) {
    stub[name] = vi.fn(notImplemented(name));
  }
  return stub;
}

export function createFakeApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return { ...fullyStubbedClient(), ...overrides };
}

export interface RenderAuthOptions {
  client?: ApiClient;
  initialEntries?: string[];
}

/** Wraps `ui` in ApiClientProvider -> AuthProvider -> MemoryRouter, the full
 * stack RequireAdmin/LoginPage/ChangePasswordPage all depend on. */
export function renderWithAuth(ui: ReactNode, options: RenderAuthOptions = {}): RenderResult {
  const client = options.client ?? createFakeApiClient();
  const initialEntries = options.initialEntries ?? ['/'];

  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ApiClientProvider client={client}>
        <AuthProvider>{ui}</AuthProvider>
      </ApiClientProvider>
    </MemoryRouter>,
  );
}
