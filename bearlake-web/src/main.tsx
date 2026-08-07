import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ConfigError, getConfig } from './config.ts';
import './styles.css';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Root element #root was not found in index.html.');
}

const root = createRoot(rootElement);

/**
 * Config is resolved before the real app ever mounts (plan W33): a missing
 * or blank VITE_API_BASE_URL renders a visible, readable error instead of a
 * blank page or a console-only crash.
 */
try {
  getConfig();
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (err) {
  const message =
    err instanceof ConfigError ? err.message : 'Something went wrong starting the app.';
  root.render(
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Configuration error</h1>
      <p>{message}</p>
    </main>,
  );
}
