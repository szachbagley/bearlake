import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.tsx';

const LINKS: { to: string; label: string }[] = [
  { to: '/announcements', label: 'Announcements' },
  { to: '/quick-tips', label: 'Quick tips' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/knowledge', label: 'Knowledge base' },
  { to: '/users', label: 'Users' },
];

/** Top nav for the guarded layout (plan step 2): current-route highlighting
 * via `NavLink`'s built-in active state, the signed-in admin's display name,
 * and sign-out. */
export function Nav() {
  const { user, logout } = useAuth();

  return (
    <nav className="nav row row--between">
      <div className="row">
        <span className="nav-brand">Bear Lake Admin</span>
        {LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) => `nav-link${isActive ? ' nav-link--active' : ''}`}
          >
            {link.label}
          </NavLink>
        ))}
      </div>
      <div className="row">
        {user !== null && <span className="text-muted">{user.displayName}</span>}
        <NavLink to="/change-password" className="nav-link">
          Change password
        </NavLink>
        <button type="button" className="btn btn--ghost" onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    </nav>
  );
}
