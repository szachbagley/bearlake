import type { ReactNode } from 'react';

/** The shared "nothing here yet" placeholder for every list screen (plan
 * step 3) — an empty announcements/quick-tips/events/categories list should
 * read as normal, not as a loading state or an error. */
export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
      <p className="text-muted">{message}</p>
      {action}
    </div>
  );
}
