import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as session from '../../src/auth/session.ts';

describe('auth/session', () => {
  beforeEach(() => {
    session.clear();
  });

  afterEach(() => {
    session.clear();
  });

  it('starts with no access token and no refresh token', () => {
    expect(session.getAccessToken()).toBeNull();
    expect(session.getRefreshToken()).toBeNull();
  });

  it('setSession stores both tokens', () => {
    session.setSession({ accessToken: 'a1', refreshToken: 'r1' });
    expect(session.getAccessToken()).toBe('a1');
    expect(session.getRefreshToken()).toBe('r1');
  });

  it('stores the refresh token in sessionStorage specifically', () => {
    session.setSession({ accessToken: 'a1', refreshToken: 'r1' });
    // Not asserting the exact key name (an implementation detail) — just
    // that it genuinely lives in sessionStorage, per plan W27.
    const raw = Object.values(window.sessionStorage).find((v) => v === 'r1');
    expect(raw).toBe('r1');
  });

  it('clear() wipes both tokens', () => {
    session.setSession({ accessToken: 'a1', refreshToken: 'r1' });
    session.clear();
    expect(session.getAccessToken()).toBeNull();
    expect(session.getRefreshToken()).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it('setRefreshToken(null) removes the stored value without touching the access token', () => {
    session.setSession({ accessToken: 'a1', refreshToken: 'r1' });
    session.setRefreshToken(null);
    expect(session.getRefreshToken()).toBeNull();
    expect(session.getAccessToken()).toBe('a1');
  });

  // Whether localStorage was ever *called* is asserted suite-wide by the
  // spy in test/setup.ts, which is the invariant plan W27 actually cares
  // about. Asserting on `localStorage.length` here would not be reliable
  // testing that invariant — vi.spyOn(window.localStorage, 'setItem') adds
  // `setItem` as an own enumerable property on the object, which jsdom's
  // Storage.length then counts as if it were a stored item.
});
