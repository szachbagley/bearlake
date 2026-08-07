import { Outlet } from 'react-router-dom';
import { Nav } from './Nav.tsx';

/** The guarded app shell (plan step 2): nav plus whichever feature route is
 * active. Mounted inside `RequireAdmin`, so by the time this renders the
 * viewer is a signed-in admin who doesn't need to change their password. */
export function Layout() {
  return (
    <div className="stack">
      <Nav />
      <div className="page">
        <Outlet />
      </div>
    </div>
  );
}
