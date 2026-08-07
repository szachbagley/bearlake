import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { ApiClientProvider, apiClient } from './api/context.tsx';
import { AuthProvider } from './auth/AuthProvider.tsx';
import { ChangePasswordPage } from './auth/ChangePasswordPage.tsx';
import { LoginPage } from './auth/LoginPage.tsx';
import { RequireAdmin } from './auth/RequireAdmin.tsx';
import { ComingSoon } from './components/ComingSoon.tsx';
import { Layout } from './components/Layout.tsx';
import { NotFoundPage } from './components/NotFoundPage.tsx';
import { RouteErrorBoundary } from './components/RouteErrorBoundary.tsx';
import { AnnouncementsPage } from './features/announcements/AnnouncementsPage.tsx';
import { QuickTipsPage } from './features/quickTips/QuickTipsPage.tsx';

/**
 * The router (plan W2, step 1). `/login` and `/change-password` sit outside
 * the guarded layout since they must be reachable while signed out or mid
 * password-change; every other screen is a child of the `RequireAdmin`-wrapped
 * `Layout` route, so the gate applies uniformly and the nav only ever renders
 * once an admin session is fully established.
 *
 * Feature routes not yet built render `ComingSoon` until their own phase
 * (§6) ships the real screen.
 */
const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: '/change-password',
    element: <ChangePasswordPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: '/',
    element: (
      <RequireAdmin>
        <Layout />
      </RequireAdmin>
    ),
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <Navigate to="/announcements" replace /> },
      { path: 'announcements', element: <AnnouncementsPage /> },
      { path: 'quick-tips', element: <QuickTipsPage /> },
      { path: 'calendar', element: <ComingSoon title="Calendar" /> },
      { path: 'knowledge', element: <ComingSoon title="Knowledge base" /> },
      { path: 'knowledge/categories/:id', element: <ComingSoon title="Category" /> },
      { path: 'knowledge/articles/:id', element: <ComingSoon title="Article" /> },
      { path: 'users', element: <ComingSoon title="Users" /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export default function App() {
  return (
    <ApiClientProvider client={apiClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ApiClientProvider>
  );
}
