/**
 * Token storage (plan W27, spec §6.4).
 *
 * The access token lives in a module variable — memory only, never React
 * state (which could end up in a devtools snapshot) and never any Storage.
 * The refresh token lives in `sessionStorage`, so the session dies with the
 * tab: an admin browser is more likely to be shared or left open than a
 * family member's phone. `localStorage` is never touched here or anywhere
 * else in this app — enforced by an eslint rule and a suite-wide spy in
 * test/setup.ts, in addition to this module simply never calling it.
 */

const REFRESH_TOKEN_KEY = 'bearlake.refreshToken';

let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getRefreshToken(): string | null {
  return sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setRefreshToken(token: string | null): void {
  if (token === null) {
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  } else {
    sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
  }
}

export function setSession(tokens: { accessToken: string; refreshToken: string }): void {
  setAccessToken(tokens.accessToken);
  setRefreshToken(tokens.refreshToken);
}

/** Wipes both tokens. Used on logout, a failed refresh, and non-admin rejection. */
export function clear(): void {
  setAccessToken(null);
  setRefreshToken(null);
}
