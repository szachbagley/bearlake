import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Dev-only proxy target (plan W33): forwards /api requests to the local
 * server so local development has no CORS involvement at all. Production
 * reads VITE_API_BASE_URL directly and never touches this proxy.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const devApiProxyTarget = env['VITE_DEV_API_PROXY'] || 'http://localhost:3000';

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: devApiProxyTarget,
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['test/setup.ts'],
      globals: false,
      include: ['test/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
      // Deterministic regardless of whether a developer's .env.local exists:
      // Vite would otherwise load it too (it's not mode-specific), so the
      // suite would pass locally but fail on a fresh clone or in CI with no
      // .env.local present. Explicit here is what makes it portable.
      env: {
        VITE_API_BASE_URL: '/api/v1',
      },
    },
  };
});
