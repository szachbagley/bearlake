import { describe, expect, it } from 'vitest';
import * as realEndpoints from '../../src/api/endpoints.ts';
import { createFakeApiClient } from './testUtils.tsx';

/**
 * Proves the fake client's function list stays in sync with the real one —
 * TypeScript alone would not catch a new endpoint added to endpoints.ts and
 * never added to the fake's ENDPOINT_NAMES list, since the fake is built
 * from a fixed array, not derived from the real module's keys.
 */
describe('createFakeApiClient', () => {
  it('stubs exactly the same function names as the real endpoints module', () => {
    const fake = createFakeApiClient();
    expect(Object.keys(fake).sort()).toEqual(Object.keys(realEndpoints).sort());
  });

  it('rejects with a clear message when a stub is called without an override', async () => {
    const fake = createFakeApiClient();
    await expect(fake.login({ email: 'x@example.com', password: 'x' })).rejects.toThrow(
      'fake API client: "login" was not stubbed for this test',
    );
  });

  it('lets a test override just the functions it needs', async () => {
    const fake = createFakeApiClient({
      logout: () => Promise.resolve(undefined),
    });
    await expect(fake.logout({ refreshToken: 'x' })).resolves.toBeUndefined();
    await expect(fake.login({ email: 'x@example.com', password: 'x' })).rejects.toThrow();
  });
});
