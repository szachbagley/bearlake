# Web admin production deployment smoke test — 2026-08-10

Web app deployed to **Vercel** from `bearlake-web/web-dev-plan.md` Phase 9,
against the API already running on Railway. Production URL:
`https://bearlake-web.vercel.app`.

Credentials and the one-time temporary password are redacted from this record.
They existed only in the browser session, Vercel's encrypted env store, and
Railway's encrypted variable store.

## Infrastructure

| Component | Detail |
|---|---|
| Web app | Vercel project `szachbagleys-projects/bearlake-web`, root directory `bearlake-web` (W34) |
| Build | `npm run build` → `dist/`, framework preset `vite`, pinned Node 22 via `engines.node` |
| SPA routing | `vercel.json` catch-all rewrite to `/index.html` — verified a deep link returns 200, not 404 |
| Env | `VITE_API_BASE_URL` (Production scope, marked Sensitive) → the Railway API's `/api/v1`. No other `VITE_*` var (W36) |
| Preview deploys | **Not connected to Git** — deploys are CLI-driven (`vercel deploy --prod`), so no preview URLs exist to be refused by the API's exact-match CORS (W35) |
| API | unchanged on Railway; only `WEB_ORIGIN` was added |
| CORS (API) | `WEB_ORIGIN` = the three Vercel production aliases, comma-separated |
| CORS (S3) | narrowed from `AllowedOrigins: ["*"]` to the three Vercel aliases + `localhost:5173/4173` |

## Production aliases allowed by `WEB_ORIGIN`

```
https://bearlake-web.vercel.app                                  (primary)
https://bearlake-web-szachbagleys-projects.vercel.app
https://bearlake-web-szachbagley-szachbagleys-projects.vercel.app
```

All three are aliases of the same production deployment. The API matches
origins by exact string (`config.webOrigins.includes(origin)`), so each must be
listed individually — a wildcard is not supported.

## Results

```
 1.  GET / (production alias)        -> 200, publicly reachable (no Deployment Protection gate)
 2.  GET /knowledge/articles/:id     -> 200 via SPA rewrite (deep link, not a 404)
 3.  CORS preflight, allowed origin  -> access-control-allow-origin: https://bearlake-web.vercel.app
 4.  CORS preflight, random origin   -> no ACAO header (correctly refused)
 5.  admin login                     -> signed in, no forced-change gate (mustChangePassword=false)
 6.  announcement create             -> appears in list with formatted postedAt
 7.  announcement edit               -> body updated, postedAt unchanged
 8.  announcement delete             -> confirmed first, then removed
 9.  quick tip create                -> appended
10.  quick tip delete                -> confirmed first, then removed
11.  event create (all-day)          -> renders in month grid + day detail with creator name
12.  event delete                    -> confirmed first, then removed
13.  category create                 -> appears with article count
14.  article create (draft-first)    -> created as draft, routed to /knowledge/articles/:id
15.  image upload -> S3              -> presign + PUT succeeded through the NARROWED bucket CORS
16.  publish + full page reload      -> image re-rendered from a freshly presigned GET (900s expiry)
17.  user create                     -> temp password modal shown (monospace, copy button, one-time warning)
18.  temp password containment       -> present in DOM only; NOT in sessionStorage, localStorage, or URL
19.  modal dismiss                   -> password cleared from the DOM
20.  user deactivate                 -> confirmed first; row dimmed, status "Deactivated"
21.  article delete                  -> confirmed first, then removed
22.  category delete                 -> confirmed first, then removed
23.  sign out                        -> session cleared, returned to /login
24.  browser console                 -> zero errors or warnings across the entire session
```

### Step 18 in detail (W27/W31)

Checked live in the deployed app while the temp-password modal was open:

```
domHasValue      : true                     (it is displayed, as intended)
leakedToTabStore : false                    (sessionStorage holds only bearlake.refreshToken)
leakedToUrl      : false
localStorage     : 0 keys                   (never used anywhere — W27)
```

## Test data cleanup

All smoke-test data was removed:

- announcement, quick tip, event, article, category — hard-deleted through the UI.
- S3 object `articles/9f9a1eb9-…/d532caad-…` — deleted via `aws s3api delete-object`;
  `head-object` then returns 404 and the bucket lists **0** objects.
- User `v1-smoke-test@example.com` — **deactivated, not deleted**. Accounts are
  never deleted in this system (authorship history must survive), so a
  deactivated row is the correct terminal state. It sits alongside the
  pre-existing deactivated `member-smoke@example.com` from the server's own
  Phase 8 smoke test.

## Deviations from the plan

- **Git integration was not connected.** The plan's Phase 9 step 6 assumed a
  repo-connected Vercel project with previews disabled. Deploying from the CLI
  reaches the same end state more simply and satisfies W35 by construction —
  with no Git connection there are no preview URLs at all. The trade-off is
  that merges to `master` do not auto-deploy; `vercel deploy --prod` from
  `bearlake-web/` is the release step. Connecting Git later is a dashboard
  toggle, at which point previews should be disabled per W35.
