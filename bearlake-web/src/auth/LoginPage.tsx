import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { ApiError } from '../api/client.ts';
import { useAuth } from './AuthProvider.tsx';

/** Shown for every failure except RATE_LIMITED (plan step 3): the server's
 * own message would otherwise reveal whether an email is a real account. */
const GENERIC_LOGIN_ERROR = 'Incorrect email or password.';

export function LoginPage() {
  const { status, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Once signed in — including a member, briefly, before RequireAdmin's
  // rejection effect runs — leave the login form. RequireAdmin (mounted
  // around the rest of the app in Phase 3) is what routes a member onward
  // to the rejection screen; this page's only job is to stop showing itself.
  if (status === 'signed-in') {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'RATE_LIMITED') {
        setError(err.message);
      } else {
        setError(GENERIC_LOGIN_ERROR);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="stack" style={{ maxWidth: '20rem', margin: '4rem auto' }}>
      <h1>Bear Lake Admin</h1>
      <form className="stack" onSubmit={(e) => void handleSubmit(e)}>
        <div className="field">
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error !== null && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {/* Spec §8.0: no self-service account creation or password reset. */}
      <p className="field-hint">
        Don&rsquo;t have an account, or forgot your password? Contact a family admin.
      </p>
    </main>
  );
}
