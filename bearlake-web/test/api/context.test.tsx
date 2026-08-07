import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider, useApiClient, type ApiClient } from '../../src/api/context.tsx';

/**
 * Proves the injection seam itself works (plan W7) — that a component calling
 * useApiClient() receives whatever was passed to the surrounding provider,
 * which is what lets feature tests substitute a fake client instead of
 * intercepting HTTP.
 */

function Probe() {
  const client = useApiClient();
  return <div data-testid="probe">{typeof client.listAnnouncements}</div>;
}

describe('ApiClientProvider / useApiClient', () => {
  it('provides whatever client value it was given', () => {
    const fake = { listAnnouncements: () => Promise.resolve({ items: [], nextCursor: null }) } as unknown as ApiClient;

    render(
      <ApiClientProvider client={fake}>
        <Probe />
      </ApiClientProvider>,
    );

    expect(screen.getByTestId('probe')).toHaveTextContent('function');
  });

  it('throws with a clear message when used outside a provider', () => {
    // Swallow the expected React error-boundary console noise for this one
    // deliberately-failing render.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow('useApiClient must be used within an ApiClientProvider.');
    spy.mockRestore();
  });
});
