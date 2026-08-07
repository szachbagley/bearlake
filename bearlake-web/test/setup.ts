import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vitest';

// vitest.config sets globals: false, so every test file imports its own
// vitest primitives; this setup file still needs afterEach for the one thing
// every test needs regardless of what it imports — unmounting between tests.
afterEach(() => {
  cleanup();
});

/**
 * localStorage is never written anywhere in this app (plan W27) — the access
 * token lives in memory, the refresh token in sessionStorage. Spying on the
 * `localStorage` instance specifically (not `Storage.prototype`, which both
 * localStorage and sessionStorage share) means this only catches calls made
 * through the banned global, leaving sessionStorage's own — expected — calls
 * alone. Suite-wide, not just in auth tests: an accidental localStorage call
 * introduced anywhere should fail loudly regardless of which feature added it.
 */
let localStorageSetItemSpy: ReturnType<typeof vi.spyOn>;
let localStorageRemoveItemSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorageSetItemSpy = vi.spyOn(window.localStorage, 'setItem');
  localStorageRemoveItemSpy = vi.spyOn(window.localStorage, 'removeItem');
});

afterEach(() => {
  expect(localStorageSetItemSpy, 'localStorage.setItem was called — see plan W27').not.toHaveBeenCalled();
  expect(
    localStorageRemoveItemSpy,
    'localStorage.removeItem was called — see plan W27',
  ).not.toHaveBeenCalled();
  localStorageSetItemSpy.mockRestore();
  localStorageRemoveItemSpy.mockRestore();

  // Isolates sessionStorage-backed session state (plan W27) between tests —
  // without this, one test's stored refresh token would leak into the next.
  window.sessionStorage.clear();
});
