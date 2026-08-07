import { useId, type ReactNode } from 'react';

/**
 * Label + input + error, with ids wired together for a11y (plan step 3).
 * `children` is a render prop receiving the id to attach to the actual
 * `<input>`/`<textarea>`/`<select>` — Field doesn't render the control
 * itself, since later phases need every input type (text, textarea, select,
 * date, checkbox) and a fixed `<input>` here would just get worked around.
 */
export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | null;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint !== undefined && error === undefined && (
        <p className="field-hint">{hint}</p>
      )}
      {error !== undefined && error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
