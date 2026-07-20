import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/helpers/setupEnv.ts'],
    // Integration tests share one MySQL test database; parallel files would
    // truncate tables out from under each other.
    fileParallelism: false,
    restoreMocks: true,
  },
});
