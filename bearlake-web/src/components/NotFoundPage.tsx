import { Link } from 'react-router-dom';

/** The catch-all for any URL that doesn't match a known route (plan step 1). */
export function NotFoundPage() {
  return (
    <main className="stack">
      <h1>Page not found</h1>
      <p className="text-muted">There&rsquo;s nothing here.</p>
      <Link to="/">Back to Bear Lake Admin</Link>
    </main>
  );
}
