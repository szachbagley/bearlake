import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { configureApiClientAuth } from '../api/client.ts';
import { useApiClient } from '../api/context.tsx';
import type { PublicUser } from '../types/api.ts';
import * as session from './session.ts';

/**
 * Session state and the auth actions every page needs (plan step 2).
 *
 * Uses `useApiClient()` rather than importing `endpoints.ts` directly, so
 * tests can render `<AuthProvider>` inside an `<ApiClientProvider>` carrying
 * a fake client (plan W7) instead of hitting a real or stubbed-fetch server.
 *
 * `rejected-non-admin` is decided here, not by RequireAdmin reacting to a
 * `signed-in` status after the fact (plan W29) — deciding it at the moment a
 * session is established, in the same synchronous stretch of the async
 * login/restore call, means RequireAdmin can be a pure function of `status`
 * with no effects or local state of its own.
 */

export type AuthStatus = 'restoring' | 'signed-out' | 'rejected-non-admin' | 'signed-in';

export interface AuthContextValue {
  status: AuthStatus;
  user: PublicUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return value;
}

interface EstablishedSession {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const api = useApiClient();
  const [status, setStatus] = useState<AuthStatus>('restoring');
  const [user, setUser] = useState<PublicUser | null>(null);

  // Single-flight guard for the boot-restore effect's own refresh() call
  // (distinct from client.ts's own single-flight, which only covers the
  // live 401-recovery path). Found via a real browser check, not a unit
  // test: React StrictMode double-invokes this effect in development, and
  // without this, two concurrent refresh() calls would present the same
  // not-yet-rotated token — the server's reuse/theft detection (D7/D36)
  // then revokes the whole token family on the second one, silently
  // signing the session back out. A ref, not a plain local variable in the
  // effect, because it must survive across the effect's double invocation.
  const inFlightRestoreRef = useRef<Promise<EstablishedSession | null> | null>(null);

  /**
   * The mechanical half of signing out: clears local storage/tokens and
   * best-effort revokes the token server-side. Deliberately does not touch
   * React state — callers decide what status follows. The public `logout()`
   * below always lands on 'signed-out'; the non-admin rejection path calls
   * this directly and keeps 'rejected-non-admin' instead, which is what
   * keeps the rejection screen up rather than it flashing for an instant
   * before bouncing to /login.
   */
  async function revokeSession(): Promise<void> {
    const refreshToken = session.getRefreshToken();
    session.clear();
    if (refreshToken !== null) {
      await api.logout({ refreshToken }).catch(() => undefined);
    }
  }

  /** Applied to the result of every call that can hand back a fresh session:
   * login and boot restore. Not changePassword, which can only be reached by
   * an already-established admin session, so role cannot have changed. */
  function settleSession(result: EstablishedSession): void {
    session.setSession({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    setUser(result.user);

    if (result.user.role !== 'admin') {
      // UI affordance, not the security boundary (plan W29) — the server
      // independently rejects every admin route regardless.
      setStatus('rejected-non-admin');
      void revokeSession();
      return;
    }

    setStatus('signed-in');
  }

  useEffect(() => {
    let cancelled = false;

    function attemptRefresh(): Promise<EstablishedSession | null> {
      inFlightRestoreRef.current ??= (async () => {
        const refreshToken = session.getRefreshToken();
        if (refreshToken === null) return null;

        try {
          return await api.refresh({ refreshToken });
        } catch {
          session.clear();
          return null;
        }
      })().finally(() => {
        inFlightRestoreRef.current = null;
      });

      return inFlightRestoreRef.current;
    }

    // Wired before the restore attempt runs, even though refresh() itself
    // uses skipAuth and never consults this — every OTHER authenticated call
    // made once restore finishes (or once login succeeds) needs it in place.
    configureApiClientAuth({
      getAccessToken: session.getAccessToken,
      refreshAccessToken: async () => {
        const result = await attemptRefresh();
        if (result === null) {
          if (!cancelled) {
            setUser(null);
            setStatus('signed-out');
          }
          return null;
        }
        session.setSession({ accessToken: result.accessToken, refreshToken: result.refreshToken });
        if (!cancelled) setUser(result.user);
        return result.accessToken;
      },
      onPasswordChangeRequired: () => {
        // Functional update, not `user` from closure: this callback is
        // registered once per effect run (deps: [api]), so a closed-over
        // `user` would go stale across logins without re-registering it.
        if (!cancelled) {
          setUser((prev) => (prev === null ? prev : { ...prev, mustChangePassword: true }));
        }
      },
    });

    // Boot-time restore (plan step 2): if a refresh token exists, establish
    // the session before first paint. RequireAdmin shows a splash for the
    // 'restoring' status in the meantime.
    void (async () => {
      const result = await attemptRefresh();
      if (cancelled) return;
      if (result === null) {
        setStatus('signed-out');
      } else {
        settleSession(result);
      }
    })();

    return () => {
      cancelled = true;
      configureApiClientAuth(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- settleSession closes over setState setters only, which React guarantees are stable; including it would re-run this effect (and re-fetch) on every render
  }, [api]);

  async function login(email: string, password: string): Promise<void> {
    const result = await api.login({ email, password });
    settleSession(result);
  }

  /** User-initiated sign-out. Always lands on 'signed-out', regardless of
   * the status it was called from — unlike the rejection path's internal
   * use of revokeSession() alone, which deliberately does not. */
  async function logout(): Promise<void> {
    // revokeSession() itself reads the token and clears storage in its own
    // synchronous prefix, before its first await — calling it here (without
    // awaiting yet) runs that clear immediately, in the same tick as the
    // setState calls below, without this function duplicating (and thereby
    // clobbering — clearing twice would make the second read-then-clear see
    // nothing to revoke) what revokeSession already does.
    const revoking = revokeSession();
    setUser(null);
    setStatus('signed-out');
    await revoking;
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const result = await api.changePassword({ currentPassword, newPassword });
    session.setSession({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    setUser(result.user);
    setStatus('signed-in');
  }

  const value: AuthContextValue = { status, user, login, logout, changePassword };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
