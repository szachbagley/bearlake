import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// vitest.config sets globals: false, so every test file imports its own
// vitest primitives; this setup file still needs afterEach for the one thing
// every test needs regardless of what it imports — unmounting between tests.
afterEach(() => {
  cleanup();
});
