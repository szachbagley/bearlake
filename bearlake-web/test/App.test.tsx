import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../src/App.tsx';

/**
 * A smoke test for the real router wiring (plan Phase 3). No refresh token
 * is present, so `AuthProvider`'s boot restore resolves to 'signed-out'
 * without ever calling `fetch` — this exercises the actual `apiClient`, not
 * a fake, so it must stay reachable without a network call.
 */
describe('App', () => {
  it('redirects an unauthenticated visitor to the login page', async () => {
    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Bear Lake Admin' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});
