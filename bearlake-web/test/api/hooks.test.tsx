import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/api/client.ts';
import { useMutation, useQuery } from '../../src/api/hooks.ts';

/**
 * A minimal harness component per hook, rather than renderHook: it exercises
 * the hooks the way real feature components will (plan W7's spirit — test
 * through the same seam production code uses).
 */

function QueryProbe({ queryFn }: { queryFn: (signal: AbortSignal) => Promise<{ n: number }> }) {
  const { data, error, loading, refetch } = useQuery(queryFn);
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="data">{data === null ? 'null' : String(data.n)}</div>
      <div data-testid="error">{error === null ? 'null' : error.message}</div>
      <button onClick={refetch}>refetch</button>
    </div>
  );
}

describe('useQuery', () => {
  it('starts loading, then resolves with data', async () => {
    let resolveFn: (value: { n: number }) => void = () => undefined;
    const queryFn = vi.fn(
      () =>
        new Promise<{ n: number }>((resolve) => {
          resolveFn = resolve;
        }),
    );

    render(<QueryProbe queryFn={queryFn} />);

    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    expect(screen.getByTestId('data')).toHaveTextContent('null');

    act(() => {
      resolveFn({ n: 7 });
    });

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('data')).toHaveTextContent('7');
    expect(queryFn).toHaveBeenCalledOnce();
  });

  it('surfaces an ApiError without crashing', async () => {
    const queryFn = vi.fn(() => Promise.reject(new ApiError(404, 'NOT_FOUND', 'Not found.')));

    render(<QueryProbe queryFn={queryFn} />);

    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('Not found.'));
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('refetch() calls queryFn again and resets to loading', async () => {
    const queryFn = vi.fn(() => Promise.resolve({ n: 1 }));
    const user = userEvent.setup();

    render(<QueryProbe queryFn={queryFn} />);
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'refetch' }));

    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
  });

  it('aborts the in-flight request on unmount', () => {
    const queryFn = vi.fn(
      (signal: AbortSignal) =>
        new Promise<{ n: number }>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );

    const { unmount } = render(<QueryProbe queryFn={queryFn} />);
    const [signal] = queryFn.mock.calls[0] as [AbortSignal];
    expect(signal.aborted).toBe(false);

    unmount();

    expect(signal.aborted).toBe(true);
  });
});

function MutationProbe() {
  const { mutate, loading, error } = useMutation((n: number) => {
    if (n < 0) return Promise.reject(new ApiError(400, 'VALIDATION_ERROR', 'must be positive'));
    return Promise.resolve(n * 2);
  });
  const [result, setResult] = useState<number | null>(null);

  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="error">{error === null ? 'null' : error.message}</div>
      <div data-testid="result">{result === null ? 'null' : String(result)}</div>
      <button onClick={() => void mutate(5).then(setResult).catch(() => undefined)}>succeed</button>
      <button onClick={() => void mutate(-1).catch(() => undefined)}>fail</button>
    </div>
  );
}

describe('useMutation', () => {
  it('resolves and updates loading around the call', async () => {
    const user = userEvent.setup();
    render(<MutationProbe />);

    await user.click(screen.getByRole('button', { name: 'succeed' }));

    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('10'));
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('error')).toHaveTextContent('null');
  });

  it('records the error and still rejects the returned promise (rethrow)', async () => {
    const user = userEvent.setup();
    render(<MutationProbe />);

    await user.click(screen.getByRole('button', { name: 'fail' }));

    await waitFor(() =>
      expect(screen.getByTestId('error')).toHaveTextContent('must be positive'),
    );
    expect(screen.getByTestId('result')).toHaveTextContent('null');
  });
});
