import { createContext, useContext, type ReactNode } from 'react';
import * as realEndpoints from './endpoints.ts';

/**
 * The API surface components call through (plan W7). Tests provide a fake
 * implementing this same shape via `<ApiClientProvider>`, so component tests
 * inject a typed double instead of intercepting HTTP — no MSW, no scattered
 * `fetch` calls in components, and the client's own wire behavior is covered
 * separately in `test/api/client.test.ts`.
 */
export type ApiClient = typeof realEndpoints;

const ApiClientContext = createContext<ApiClient | null>(null);

export function ApiClientProvider({
  client,
  children,
}: {
  client: ApiClient;
  children: ReactNode;
}) {
  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>;
}

export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (client === null) {
    throw new Error('useApiClient must be used within an ApiClientProvider.');
  }
  return client;
}

/** The real client, for main.tsx to provide at the app root (Phase 3). */
export const apiClient: ApiClient = realEndpoints;
