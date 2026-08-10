/**
 * The 409 STALE_ARTICLE prompt (plan W16, D23) — deliberately **not** built
 * on the shared `Modal`: that component closes on Escape and an overlay
 * click, and this must not be dismissable any other way than the two
 * explicit actions below. Never auto-overwrites.
 */
export function StaleArticleDialog({
  changesJson,
  onReload,
}: {
  changesJson: string;
  onReload: () => void;
}) {
  async function handleCopyAndReload(): Promise<void> {
    try {
      await navigator.clipboard.writeText(changesJson);
    } catch {
      // Best-effort — the admin still needs to reload either way, and a
      // clipboard failure shouldn't leave them stuck on this prompt.
    }
    onReload();
  }

  return (
    <div className="modal-overlay">
      <div
        className="modal card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="stale-article-title"
      >
        <div className="stack">
          <h2 id="stale-article-title">This article changed elsewhere</h2>
          <p>
            Someone else saved a change to this article since you loaded it. Your local changes
            can&rsquo;t be saved on top of theirs — reload to see the latest version, or copy your
            changes first so you don&rsquo;t lose them.
          </p>
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={onReload}>
              Reload
            </button>
            <button type="button" className="btn" onClick={() => void handleCopyAndReload()}>
              Copy my changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
