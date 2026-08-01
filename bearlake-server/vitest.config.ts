import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/helpers/globalSetup.ts'],
    setupFiles: ['test/helpers/setupEnv.ts'],
    // Integration tests share one MySQL test database; parallel files would
    // truncate tables out from under each other.
    fileParallelism: false,
    // These are real integration tests: bcrypt at cost 12 is ~200ms per hash
    // and a test that opens two sessions does several, plus DB round-trips.
    // Run serially, the whole suite loads the machine enough that the default
    // 5s per-test limit flakes; 20s absorbs the spikes without masking a hang.
    testTimeout: 20_000,
    restoreMocks: true,
  },
});
