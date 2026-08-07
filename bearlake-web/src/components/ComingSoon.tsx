/** Placeholder for a feature route whose real screen ships in a later phase
 * (§6 of web-dev-plan.md) — Phase 3 wires the route and nav entry, not the
 * feature itself. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <main className="stack">
      <h1>{title}</h1>
      <p className="text-muted">This screen isn&rsquo;t built yet.</p>
    </main>
  );
}
