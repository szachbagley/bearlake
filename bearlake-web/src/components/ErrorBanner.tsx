import { ApiError } from '../api/client.ts';

/** Renders an error's display-safe message (plan W13: `message` is always
 * safe to show to a user). Accepts `unknown` since it usually sits directly
 * on a catch block's error. */
export function ErrorBanner({ error }: { error: unknown }) {
  const message =
    error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';

  return (
    <p className="error-banner" role="alert">
      {message}
    </p>
  );
}
