import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthProvider.tsx';

/**
 * Route guard (plan W30): unauthenticated -> /login; mustChangePassword ->
 * /change-password; non-admin -> the rejection screen below.
 *
 * A pure function of `status`/`user` — no effects, no local state. The
 * non-admin rejection (plan W29) is decided in AuthProvider, at the moment a
 * session is established, which is what makes `rejected-non-admin` a status
 * this component can just render directly rather than reacting to a
 * `signed-in` status after the fact.
 *
 * This is a UI affordance, not the security boundary — the server
 * independently rejects every admin route regardless of what this component
 * does. Login itself is role-agnostic on the server; a member typing their
 * own real credentials into this tool is expected and must be handled
 * gracefully, not treated as an attack.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();

  if (status === 'restoring') {
    return <Splash />;
  }

  if (status === 'signed-out') {
    return <Navigate to="/login" replace />;
  }

  if (status === 'rejected-non-admin') {
    return <NotAuthorized />;
  }

  // status === 'signed-in' from here; user is populated whenever it is.
  if (user?.mustChangePassword === true) {
    return <Navigate to="/change-password" replace />;
  }

  return <>{children}</>;
}

function Splash() {
  return (
    <main className="stack" style={{ padding: 'var(--space-6)' }}>
      <p className="text-muted">Loading…</p>
    </main>
  );
}

/** Spec §10.1: "This tool is for family admins." Not a blank page, not a
 * redirect loop — a stable screen, since AuthProvider settles on this status
 * deliberately rather than RequireAdmin inferring and re-deriving it. */
function NotAuthorized() {
  return (
    <main className="stack" style={{ padding: 'var(--space-6)' }}>
      <h1>This tool is for family admins</h1>
      <p>
        The Bear Lake admin site is for the two family admins only. For the calendar,
        announcements, and cabin information, use the Bear Lake app on your phone.
      </p>
    </main>
  );
}
