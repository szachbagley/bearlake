import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './client.ts';

/**
 * Hand-rolled query/mutation hooks (plan W3). No cache: every mount and every
 * explicit refetch() makes a fresh request. That's the accepted cost — two
 * users, a handful of screens, and every mutation is followed by an explicit
 * refetch, so a cache layer would add concepts this app does not need.
 */

/** Rethrows anything that isn't a genuine ApiError instead of hiding a bug
 * behind a fabricated error state — request() only ever throws ApiError, so
 * anything else here means something upstream is broken. */
function asApiErrorOrRethrow(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  throw err;
}

export interface QueryResult<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  refetch: () => void;
}

/**
 * `queryFn` is called on mount and on every `refetch()`, with an AbortSignal
 * that fires on unmount or re-run — genuine cancellation (not just ignoring
 * a stale result), so an abandoned request stops costing network and server
 * work. Wrap `queryFn` in `useCallback` at the call site so it only changes
 * when its real inputs do; a fresh inline function re-queries every render.
 */
export function useQuery<T>(queryFn: (signal: AbortSignal) => Promise<T>): QueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    // This is React's own documented shape for a data-fetching effect
    // (reset state synchronously, then fetch, guarding the eventual setState
    // with a cancelled flag) — see the "Fetching data" example in the
    // useEffect docs. react-hooks 7's set-state-in-effect rule is stricter
    // than that guidance; the batched reset here is one render, not a cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);

    queryFn(controller.signal)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(asApiErrorOrRethrow(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [queryFn, tick]);

  const refetch = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  return { data, error, loading, refetch };
}

export interface MutationResult<TArgs extends unknown[], TResult> {
  /** Resolves with the result on success. Also re-throws on failure, after
   * recording it in `error`, so callers can `await` for control flow (e.g.
   * "navigate away on success") while this hook's state stays available for
   * passive display. */
  mutate: (...args: TArgs) => Promise<TResult>;
  loading: boolean;
  error: ApiError | null;
}

export function useMutation<TArgs extends unknown[], TResult>(
  mutationFn: (...args: TArgs) => Promise<TResult>,
): MutationResult<TArgs, TResult> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const mutate = useCallback(
    async (...args: TArgs): Promise<TResult> => {
      setLoading(true);
      setError(null);
      try {
        const result = await mutationFn(...args);
        setLoading(false);
        return result;
      } catch (err) {
        setError(asApiErrorOrRethrow(err));
        setLoading(false);
        throw err;
      }
    },
    [mutationFn],
  );

  return { mutate, loading, error };
}
