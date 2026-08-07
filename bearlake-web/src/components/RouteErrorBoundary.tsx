import { isRouteErrorResponse, useRouteError } from 'react-router-dom';

/**
 * A route-level error boundary (plan step 4), wired as every route's
 * `errorElement`. A thrown render error anywhere in a route's tree lands
 * here instead of unmounting the whole app to a blank screen — the nav
 * stays interactive (this is scoped per-route, not global) so the admin can
 * navigate away rather than reload.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();

  const message = isRouteErrorResponse(error)
    ? `${String(error.status)} ${error.statusText}`
    : 'Something went wrong loading this page.';

  return (
    <main className="stack" style={{ padding: 'var(--space-6)' }}>
      <h1>Something went wrong</h1>
      <p className="error-banner" role="alert">
        {message}
      </p>
      <a href="/">Back to Bear Lake Admin</a>
    </main>
  );
}
