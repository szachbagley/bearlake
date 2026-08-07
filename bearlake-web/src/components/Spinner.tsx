/** A minimal loading indicator (plan step 3). `role="status"` plus visually
 * hidden text gives assistive tech an announcement without a visible label
 * cluttering every loading list/button. */
export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <span className="sr-only">{label}</span>
    </span>
  );
}
