# Bear Lake Web Admin — Development Plan

**Scope:** `bearlake-web/` only. React + TypeScript, deployed as a static build.
**Sources of truth:** `CLAUDE.md`, `docs/bear-lake-tech-spec.md` §10, and the **live API contract** in `bearlake-server/` (built and deployed; see `bearlake-server/server-dev-plan.md` for its decision record, referenced below as D-numbers).
Where those documents leave a decision open, this plan closes it (§2). Development is execution of this plan; deviations require updating this document first.

---

## 1. Goal

An admin-only web app for two people that is the **primary authoring surface** for knowledge base articles and the **only** surface for user management. It uses the same `/api/v1` endpoints, validation, and authorization as iOS — no privileged path.

Screens: login, forced/voluntary password change, announcements, quick tips, calendar events, knowledge base (categories → articles → block editor), users.

Non-goals: member-facing features, mobile layouts, a design system, offline support, real-time collaboration.

---

## 2. Decision record

Every open or unspecified choice, resolved. Final for v1.

### Stack and tooling

| # | Decision | Choice | Rationale |
|---|---|---|---|
| W1 | Build tool | **Vite 8** + `@vitejs/plugin-react`, **React 19**, TypeScript `strict: true` (plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` — matching the server's tsconfig rigor). Take current majors at scaffold time; do not pin patch versions. | Boring default for a React SPA; no framework (Next.js) because there is no SSR, no routing-by-filesystem need, and a static build is the deployment target. |
| W2 | Routing | **`react-router-dom` 7**, `createBrowserRouter`. | Eight screens with nested layout, route guards, and URL-addressable article editing. Hand-rolling this costs more than the dependency. |
| W3 | Data fetching | **Hand-rolled hooks** (`useQuery`/`useMutation` equivalents, ~80 lines total in `api/hooks.ts`): loading/error/data, manual `refetch`, abort on unmount, no cache. **No TanStack Query.** | Two users, a handful of screens, and every mutation is followed by an explicit refetch. A cache layer would add concepts and a dependency to solve a problem this app does not have. Accepted cost: no automatic background refresh or cross-screen cache sharing — both unnecessary here. |
| W4 | Forms | Hand-rolled controlled inputs validated with **zod** on submit. **No react-hook-form.** | Forms are small (2–5 fields). zod is already the server's validation vocabulary (W5). |
| W5 | Shared validation | Web keeps its **own** zod schemas in `src/types/`, mirroring the server's. A **drift test** reads `../bearlake-server/src/schemas/*.ts` from disk at test time and asserts every shared limit and pattern matches. No imports across app boundaries, no workspace tooling. | `CLAUDE.md` wants schema reuse but forbids workspace tooling and root manifests. A checked-in mirror plus an automated drift check gets the safety without coupling the builds. The test fails loudly the day the server changes a cap. |
| W6 | Styling | One global `src/styles.css`: element styles, ~15 utility classes, CSS custom properties for the handful of colors/spacings. **No** Tailwind, CSS-in-JS, component library, or CSS modules. | "Internal tool for two people; do not build a design system." Semantic HTML with real `<form>`, `<table>`, `<button>` gets accessible behavior for free. |
| W7 | Testing | **Vitest** + **@testing-library/react** + **user-event** + **jest-dom** + **jsdom**. Components are tested against an **injected fake API client** (via context); the API client itself is tested against a stubbed `fetch`. **No MSW.** | Injecting the typed client is simpler than intercepting HTTP and keeps tests fast. The client's own wire behavior is covered directly. |
| W8 | E2E verification | **No Playwright/Cypress.** End-to-end verification is manual-but-scripted via the **claude-in-chrome** MCP server at each phase gate (§7). | An automated E2E rig is heavy maintenance for a two-user internal tool. Driving the real browser at each gate — with console and network inspection — catches what unit tests cannot, without a second test stack to maintain. |
| W9 | Linting | ESLint flat config: `typescript-eslint` recommended-type-checked, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`. `no-console: error` except one logging module. **No Prettier** (the server does not use it either). | Consistency with `bearlake-server/`. |
| W10 | Node version | Pinned to 22 via `.node-version` and `engines`. | Matches the deployed server. |

**Dependency list (final — approval of this plan is the "ask before adding" for these, and nothing else):**

- Runtime: `react`, `react-dom`, `react-router-dom`, `zod`
- Dev: `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `@types/react`, `@types/react-dom`

Explicitly **not** added: any rich-text editor (TipTap/Lexical/Quill/Slate — forbidden by `CLAUDE.md`), any drag-and-drop library (W20), any date library (W17), any UI kit, TanStack Query, MSW, Playwright.

### API contract compliance

These follow from the server as built. Getting them wrong produces 400s that look like client bugs.

| # | Decision | Choice | Rationale |
|---|---|---|---|
| W11 | Strict request bodies | Every request sends **exactly** the documented fields — no extras, no `schemaVersion`, no `id` on create, no `email`/`password` on user PATCH. | Server uses `z.strictObject` everywhere (server D38): an unknown key is a **400**, not a silent strip. The typed client's request types must be exact, not `Partial<Entity>`. |
| W12 | Response envelopes | List endpoints return a **named wrapper**; single-entity endpoints return the entity bare. Verified against the server: `{ users }`, `{ events }`, `{ categories }`, `{ articles }`, `{ quickTips }`, `{ items, nextCursor }` (announcements), and bare objects for create/get/patch. `DELETE` and `logout` return **204 with no body**. | The client's response types are written per-endpoint from this table, not guessed. |
| W13 | Error model | One shape: `{ error: { code, message } }`. Client maps to a typed `ApiError { status, code, message }`. Codes: `VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `UNAUTHENTICATED`, `FORBIDDEN`, `PASSWORD_CHANGE_REQUIRED`, `ACCOUNT_DISABLED`, `NOT_FOUND`, `STALE_ARTICLE`, `CATEGORY_NOT_EMPTY`, `EMAIL_IN_USE`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `INTERNAL`. | `message` is written to be shown to a user; the UI displays it directly rather than inventing its own copy, except where a code needs a specific interaction (409 reload offer, 403 gate redirect). |
| W14 | Events range query | `GET /events` **requires** `start` and `end` (ISO instants, `start < end`, window ≤ 366 days). The calendar fetches the visible month ± one month. | Server D16. There is no unbounded events query. |
| W15 | All-day vs timed events | Two shapes discriminated by `isAllDay`. All-day sends/receives **date-only** `YYYY-MM-DD` with `endsAt` the **last day, inclusive**. Timed sends/receives **ISO instants with offset**. Mixing shapes is a 400. | Server D15/D17. A Jul 16–20 stay is `startsAt: "2026-07-16", endsAt: "2026-07-20"` and the UI must label it as *through* Jul 20. |
| W16 | Article concurrency | `PATCH /info/articles/:id` always sends the `updatedAt` the editor loaded. A `409 STALE_ARTICLE` shows a non-dismissable prompt: **Reload** (discard local edits) or **Copy my changes** (dump blocks JSON to clipboard, then reload). Never auto-overwrite. | Server D23. Two admins is enough for conflict, and silent overwrite is the one data-loss path this project actually has. |

### Dates and time

| # | Decision | Choice | Rationale |
|---|---|---|---|
| W17 | No date library, no hand-rolled timezone conversion | Timed events use `<input type="datetime-local">` in the **browser's** timezone; `new Date(localValue).toISOString()` produces the UTC instant natively. Display uses `Intl.DateTimeFormat`. | The browser already does DST-correct local↔UTC conversion. Hand-rolling a zoned conversion (or adding date-fns-tz) would introduce risk to solve a problem the platform solves. |
| W18 | Cabin-time echo | Every timed-event input and display is labeled with the active timezone. When the browser's timezone is **not** `America/Denver`, the UI additionally shows the same instant formatted in cabin time via `Intl.DateTimeFormat(..., { timeZone: 'America/Denver' })`. | An admin traveling could otherwise enter "3pm" meaning cabin time and store 3pm Eastern. The echo is pure display formatting — still no timezone math — and disappears for the common case of both admins in Mountain Time. iOS renders viewer-local, which is right for "when is my stay"; presentation differs, the stored instants do not. |
| W19 | Never build a `Date` from a date-only string | All-day dates are handled as **strings**. Formatting splits `YYYY-MM-DD` into components and formats them directly; comparison is lexicographic. `new Date('2026-07-16')` is **banned** (an ESLint-visible convention plus a unit test on the helpers). | `new Date('2026-07-16')` parses as **UTC** midnight and renders as Jul 15 for any negative-offset viewer — the exact class of bug the spec warns about. Day-boundary logic lives in one `utils/dates.ts`, not per view. |

### Article editor

| # | Decision | Choice | Rationale |
|---|---|---|---|
| W20 | Block reordering | **Move up / move down buttons**, keyboard-operable, plus `aria-live` announcement of the new position. **No drag-and-drop.** | DnD without a library is fragile and inaccessible; with a library it is a dependency for a list a family admin reorders occasionally. Buttons are boring, testable, and work with a keyboard. |
| W21 | Draft-first creation | "New article" collects title + category and **immediately creates a `draft` on the server**, then routes to `/knowledge/articles/:id`. Block editing only ever happens against a persisted article. | `POST /uploads/presign` requires an existing `articleId` (server D25). This is the client-side implication the server plan recorded; making creation a two-step flow means an image upload can never be blocked by "save the article first." |
| W22 | Explicit save, dirty guard | The editor holds local state and saves on an explicit **Save** button (also `Cmd/Ctrl+S`). No autosave. Navigating away with unsaved changes triggers a confirm, and a `beforeunload` guard covers tab close. | Autosave plus optimistic concurrency means constant 409 churn between two admins. Explicit save makes the concurrency model comprehensible. |
| W23 | Unknown block preservation | A block whose `type` the editor does not recognize renders **read-only** ("Unsupported block — preserved on save") and round-trips **unchanged**. | Mirrors the iOS rule. The server currently rejects unknown types, so this can only trigger after a future schema addition — which is exactly when silently dropping content would be unrecoverable. |
| W24 | Image upload pipeline | Pick file → validate type against the allowlist (`image/jpeg`, `image/png`, `image/heic`) → **downscale in-browser** via `<canvas>` to max 2000px on the long edge, re-encode JPEG q0.85 → `POST /uploads/presign` with the **post-downscale** byte length → `PUT` bytes to S3 with the exact `Content-Type` → store the returned **key** in the block. | Spec §4.5 requires client downscale. The presigned PUT signs `Content-Type` **and** `Content-Length` (server D25), so the declared length must be the bytes actually sent — a mismatch is rejected by S3, not by us. HEIC cannot be decoded by `<canvas>` in most browsers: HEIC files are uploaded **as-is without downscale**, with a size warning above 10 MB. |
| W25 | Image display | Image blocks render from the transient `url` the API attaches at read time. The **`key` is what is persisted**; `url` is stripped from every block before any write. | Server D24. Persisting a presigned URL would bake in an expiry and bucket name. A test asserts no write body contains `url`. |
| W26 | Video blocks | Input accepts a YouTube URL (`watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`) or a bare ID; the client extracts and stores the **11-character ID** only. Preview via `youtube-nocookie.com` embed. | Server validates `^[A-Za-z0-9_-]{11}$`. Accepting a pasted URL is the affordance a non-technical author needs. |

### Auth and session

| # | Decision | Choice | Rationale |
|---|---|---|---|
| W27 | Token storage | Access token **in memory only** (module-scoped, never in React state or storage). Refresh token in **`sessionStorage`**. `localStorage` is **banned** — enforced by a lint rule and a grep in the review checklist. | Spec §6.4. An admin browser is likelier to be shared or left open than a phone, so the session dies with the tab. |
| W28 | Refresh on 401 | A single-flight refresh: the first 401 triggers `POST /auth/refresh`; concurrent 401s await the same in-flight promise and then retry once. A failed refresh clears the session and routes to `/login`. Never retry more than once. | Refresh tokens rotate and reuse of a rotated token revokes the family (server D7/D36) — parallel refreshes would look like theft and sign the admin out. |
| W29 | Non-admin rejection | Login is role-agnostic on the server. If the authenticated user's `role !== 'admin'`, the web app **revokes its own session** (`POST /auth/logout`) and shows a clear "This tool is for family admins — use the Bear Lake app on your phone" screen. Not a blank page, not a redirect loop. | Spec §10.1. This is a **UI affordance, not security** — the server independently rejects every admin route. Stated in code comments so no one mistakes it for the control. |
| W30 | Password-change gate | A `403 PASSWORD_CHANGE_REQUIRED` from **any** call routes to `/change-password`, which is non-dismissable (no nav, no back-out) until it succeeds. The forced flow still requires the current password (the temp one the admin just typed), held in memory only. | Server D8/D9. Both clients implement this gate. |
| W31 | Temp password handling | The one-time password from `POST /users` and `POST /users/:id/reset-password` appears in a **modal**: large monospace text, **Copy** button, and an explicit warning that it cannot be retrieved. Cleared from component state on dismiss. **Never** in a URL, query param, log, or `sessionStorage`. | Spec §10.1. These are the only two responses in the system carrying a plaintext credential. |
| W32 | Sensitive content | Announcement and quick-tip bodies (gate codes, marina passcodes, key locations) are **never** written to `console`, an error report, or any analytics. The app has no analytics and one logging module that takes scalars only. | Spec §6.5. |

### Configuration and deployment

| # | Decision | Choice | Rationale |
|---|---|---|---|
| W33 | API base URL | `VITE_API_BASE_URL`, validated at startup by a tiny config module that throws a visible error page if missing/malformed. **Dev** uses a Vite proxy (`/api` → `http://localhost:3000`) so local development has no CORS involvement at all. | One place resolves the API origin. The dev proxy removes a whole class of "works locally, breaks deployed" confusion. |
| W34 | Hosting | **Vercel**, as its own project separate from the API: root directory `bearlake-web`, build `npm run build`, output `dist/`, with a checked-in `vercel.json` rewriting all paths to `index.html` so deep links work. Not served from the Express app, and **not on Railway** (superseded; see W34a). Closes spec open decision #3. | `CLAUDE.md`: "the three apps are independent," each built and deployed separately. Serving the SPA from Express would couple their deploys and add a route the API does not otherwise need. |
| W34a | Why Vercel over Railway | Amended after Phase 8. Vercel is the zero-config path for a Vite SPA (framework detection, static CDN, SPA fallback); Railway would mean running a static file server for a bundle of files, configured by hand, for no benefit this app can use. The author already deploys UI on Vercel and APIs on Railway. | Accepted costs, both small and both recorded here so they are not surprises: a second dashboard/billing surface alongside the API's Railway project, and preview deployments that cannot reach the API (W35). |
| W35 | CORS | Deploying the web app requires setting **`WEB_ORIGIN`** on the **API service (Railway)** to the web app's **Vercel production domain** (comma-separated allowlist; currently unset, so browsers are blocked today). A **server env change, not a code change**, performed in Phase 9. The API matches origins **exactly** — `config.webOrigins.includes(origin)` in `bearlake-server/src/app.ts`, no wildcard support — so every Vercel **preview** deployment, which gets its own generated URL, would be refused by the API. v1 therefore **turns Git preview deployments off** for this project: a preview that can only render the login screen is worse than no preview, because it looks broken. | The API's CORS allowlist is already implemented and reads this variable. Recorded here because it is the one cross-app step, and because exact-match origins are precisely what makes per-branch preview URLs a non-starter without adding each one by hand. Reversible: if a preview is ever genuinely needed, add that specific URL to `WEB_ORIGIN` and redeploy the API. |
| W36 | Build-time secrets | **None.** Vite inlines every `VITE_*` variable into public JavaScript; only the API base URL is ever exposed, set as a Production-scoped environment variable in the Vercel project. No AWS keys, no JWT secret, no database URL in this app, ever. | A `VITE_`-prefixed secret is a published secret. Called out because it is an easy and unrecoverable mistake — and Vercel's env UI makes adding one frictionless, which is exactly the hazard. |

---

## 3. Environment variables

`.env.example` (checked in; `.env.local` gitignored):

```
# Base URL of the API, including /api/v1.
# Dev: leave as the proxy path below and Vite forwards to the local server.
VITE_API_BASE_URL=/api/v1

# Dev-only: where the Vite proxy forwards /api requests.
VITE_DEV_API_PROXY=http://localhost:3000

# Production example (set in the Vercel project's env settings, not committed).
# The value points at the API, which is deployed on Railway:
# VITE_API_BASE_URL=https://bearlake-server-production.up.railway.app/api/v1
```

No other variables. See W36.

---

## 4. Project structure (target)

```
bearlake-web/
  package.json  tsconfig.json  vite.config.ts  eslint.config.js
  .env.example  .node-version  index.html  vercel.json
  src/
    main.tsx            — entry, router, providers
    config.ts           — VITE_* validation (W33)
    styles.css          — the entire stylesheet (W6)
    api/
      client.ts         — typed fetch wrapper, ApiError, 401 refresh (W28)
      endpoints.ts      — one typed function per API route
      hooks.ts          — useQuery/useMutation equivalents (W3)
      context.tsx       — provides the client; tests inject a fake (W7)
    auth/
      session.ts        — token store: memory + sessionStorage (W27)
      AuthProvider.tsx  — current user, login/logout, gate state
      RequireAdmin.tsx  — route guard (W29/W30)
      LoginPage.tsx  ChangePasswordPage.tsx
    components/         — Layout, Nav, Modal, ConfirmDialog, ErrorBanner,
                          Field, Spinner, EmptyState, CopyButton
    features/
      announcements/  quickTips/  users/  calendar/
      articles/       — CategoryList, ArticleList, ArticleEditor,
                        blocks/{HeadingBlock,ParagraphBlock,BulletsBlock,
                        ImageBlock,VideoBlock,UnknownBlock}, upload.ts
    types/
      api.ts            — entity + request/response types (W11/W12)
      blocks.ts         — block union + zod schema, mirrors server (W5)
      limits.ts         — shared caps/patterns, drift-tested (W5)
    utils/
      dates.ts          — all date formatting/parsing (W17/W18/W19)
      youtube.ts        — ID extraction (W26)
      image.ts          — downscale (W24)
  test/
    setup.ts            — jest-dom, cleanup
    fakeClient.ts       — in-memory API double (W7)
    drift.test.ts       — server schema drift check (W5)
```

---

## 5. Phase gate

A phase is complete only when all of the following pass, in order:

1. `npm run lint` — zero errors
2. `npm run typecheck` — zero errors (`tsc --noEmit`, strict)
3. `npm test` — all tests green, including every prior phase's
4. `npm run build` — production build succeeds
5. **Self-review against the §7 checklist** for every file touched
6. **Browser verification** via claude-in-chrome (§8): exercise the phase's screens against a **real running API**, confirm zero console errors and no unexpected network failures, and capture a screenshot of each new screen
7. Commit with a message naming the phase; open a PR per the repo's per-phase workflow

Do not start phase N+1 with phase N's gate unmet.

---

## 6. Phases

### Phase 0 — Scaffold

**Steps:**

1. `npm create vite@latest` (react-ts), then align to this plan: install exactly the §2 dependency list.
2. `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `jsx: react-jsx`.
3. `eslint.config.js` per W9, including a `no-restricted-globals`/`no-restricted-properties` rule banning `localStorage` (W27) and a `no-restricted-syntax` rule flagging `new Date(` with a string literal argument (W19).
4. `vite.config.ts`: React plugin, dev proxy `/api` → `VITE_DEV_API_PROXY` (W33), Vitest config (`environment: 'jsdom'`, `setupFiles: test/setup.ts`, `globals: false`).
5. `src/config.ts` (W33) + `.env.example` + `.node-version` + `.gitignore` (`node_modules`, `dist`, `.env.local`).
6. `src/styles.css` skeleton (W6): CSS custom properties, base element styles, `.stack`/`.row`/`.card`/`.btn`/`.field`/`.error` utilities.
7. `src/main.tsx` rendering a placeholder shell; `index.html` title "Bear Lake Admin".
8. Scripts: `dev`, `build` (`tsc -b && vite build`), `preview`, `test`, `lint`, `typecheck`.

**Tests:** config module throws on missing/blank `VITE_API_BASE_URL` and accepts a valid one; the app shell renders its heading.

**Gate:** §5 (browser check: `npm run dev` serves the shell with a clean console).

### Phase 1 — Types, API client, and the drift test

**Steps:**

1. `src/types/api.ts` — entity types transcribed from the server: `PublicUser`, `Event`, `Announcement`, `QuickTip`, `InfoCategory`, `ArticleSummary`, `InfoArticle`, `ApiBlock`, `SessionResult`, `AnnouncementPage`. Request types are **exact** per W11 (e.g. `CreateUserRequest = { displayName; email; role }` — nothing else).
2. `src/types/blocks.ts` — the block discriminated union + zod schema mirroring the server, including the `unknown` passthrough for W23.
3. `src/types/limits.ts` — every shared constant in one place: title/body/text caps, block caps, `IMAGE_KEY_PATTERN`, `YOUTUBE_ID_PATTERN`, upload allowlist, `MAX_UPLOAD_BYTES`, announcement page size max.
4. `test/drift.test.ts` (W5) — reads the server's `schemas/articles.ts`, `schemas/uploads.ts`, `schemas/events.ts`, `schemas/announcements.ts`, `schemas/quickTips.ts`, `schemas/users.ts` from disk and asserts each mirrored limit/pattern appears there. Fails with a message naming the drifted constant.
5. `src/api/client.ts` — `request<T>()` wrapper: base URL, JSON headers, bearer injection, **204 → `undefined`** (W12), error-body → typed `ApiError`, network failure → `ApiError` with a friendly message. Single-flight 401 refresh (W28) wired via injected callbacks so `auth/session` and the client do not import each other circularly.
6. `src/api/endpoints.ts` — one typed function per route, grouped by resource, matching the §W12 envelope table exactly.
7. `src/api/hooks.ts` (W3) and `src/api/context.tsx` (W7).

**Tests (against stubbed `fetch`):** success parses the envelope; 204 yields `undefined`; an error body maps to `ApiError` with the right `code`/`status`; a non-JSON 500 still yields `INTERNAL`; a 401 triggers exactly one refresh and one retry; **two concurrent 401s trigger exactly one refresh call** (single-flight); a failed refresh clears the session and does not retry again; the drift test passes.

**Gate:** §5.

### Phase 2 — Auth, session, and gates

**Steps:**

1. `auth/session.ts` (W27): access token in a module variable; refresh token in `sessionStorage` under one key; `clear()` wipes both.
2. `auth/AuthProvider.tsx`: `login`, `logout`, `changePassword`, current user, and a boot-time **session restore** — if a refresh token exists, call `POST /auth/refresh` then `GET /me` before first paint (a splash while resolving).
3. `LoginPage`: email + password, one generic error for any failure, `RATE_LIMITED` shown with its message. **No** "create account" or "forgot password" affordances — instead static text directing the user to contact a family admin.
4. Non-admin rejection (W29) with its own screen and a self-logout.
5. `ChangePasswordPage`: current + new + confirm; client-side length ≥ 12 and match check; server `VALIDATION_ERROR` messages surfaced verbatim. Serves both the forced (non-dismissable, no nav) and voluntary (reachable from the layout) flows.
6. `RequireAdmin` guard (W30): unauthenticated → `/login`; `mustChangePassword` → `/change-password`; non-admin → rejection screen.
7. Global 403 `PASSWORD_CHANGE_REQUIRED` interception in the client → route to the gate.

**Tests:** login success stores tokens and lands on the app; failed login shows the generic message and stores nothing; a member login is rejected **and** `logout` is called; `mustChangePassword: true` forces the gate and blocks navigation away; a successful change clears the gate and installs the new token pair; boot restore with a valid refresh token yields a signed-in app; boot restore with a rejected refresh token lands on login with `sessionStorage` cleared; **`localStorage` is never written** (spy asserts zero calls across the suite).

**Gate:** §5 + browser check of the full first-run flow against the deployed API using a real admin account.

### Phase 3 — App shell, routing, shared components

**Steps:**

1. Router (W2): `/login`, `/change-password`, and a guarded layout with `/announcements` (index), `/quick-tips`, `/calendar`, `/knowledge`, `/knowledge/categories/:id`, `/knowledge/articles/:id`, `/users`, plus a catch-all 404.
2. `Layout` + `Nav` (current-route highlighting, signed-in display name, sign-out, "Change password").
3. Shared components: `Modal` (focus trap, Escape, restores focus), `ConfirmDialog` (used by every destructive action), `ErrorBanner` (renders an `ApiError`'s message), `Field` (label + input + error, ids wired for a11y), `Spinner`, `EmptyState`, `CopyButton`.
4. A route-level error boundary rendering a recoverable error page rather than a blank screen.

**Tests:** guarded routes redirect when unauthenticated; nav highlights the active route; `Modal` traps focus, closes on Escape, and restores focus to the trigger; `ConfirmDialog` resolves only on confirm; the error boundary catches a thrown render error.

**Gate:** §5.

### Phase 4 — Announcements and quick tips

The simplest CRUD; establishes the list/form/delete pattern every later feature reuses.

**Steps:**

1. Announcements list: reverse-chronological, date + body, **"Load more"** driving the opaque cursor (`{ items, nextCursor }`, `nextCursor: null` ends). Create/edit inline or in a modal; body ≤ 5000 with a live counter; delete behind `ConfirmDialog`.
2. `postedAt` is displayed but **not editable** (server D18); edit sends `{ body }` only (W11).
3. Quick tips list ordered by `sortOrder`; create appends; edit body; **move up/down** adjusting `sortOrder` via PATCH; delete behind confirm. Body ≤ 1000.
4. Both surfaces treat bodies as sensitive (W32) — no logging.

**Tests:** list renders items and paginates without duplicates; "Load more" disappears at the end; create/edit/delete call the right endpoints with **exactly** the allowed fields; over-length bodies are blocked client-side before the request; delete is not issued unless confirmed; a `FORBIDDEN` response surfaces the server's message rather than a crash.

**Gate:** §5 + browser check (create → edit → paginate → delete against the real API, then clean up the rows).

### Phase 5 — Users

The only surface for user management, and the only one handling plaintext credentials.

**Steps:**

1. Users table: display name, email, role, active, last login (relative + absolute on hover). Deactivated rows visually distinct.
2. Create user form (`displayName`, `email`, `role`) → **temp password modal** per W31.
3. Edit: display name, role, active toggle. Deactivation is confirmed with copy explaining it ends the user's sessions immediately and preserves authorship history (accounts are never deleted).
4. Reset password → confirm → temp password modal (W31), with copy noting it signs that user out everywhere.
5. Self-protection: the current admin's own row disables the role and active controls with an explanatory tooltip — the server refuses these (403), and disabling them avoids presenting an action that cannot succeed.
6. `EMAIL_IN_USE` (409) is surfaced on the email field, not as a generic banner.

**Tests:** create shows the temp password exactly once and clears it on dismiss; **the temp password never reaches `sessionStorage`, `localStorage`, the URL, or `console`** (explicit assertions); copy button copies the exact value; self-row controls are disabled; deactivate and reset both require confirmation; `EMAIL_IN_USE` maps to the email field; the table renders deactivated users distinctly.

**Gate:** §5 + browser check (create a throwaway member, verify the modal, reset its password, deactivate it).

### Phase 6 — Calendar and events

**Steps:**

1. `utils/dates.ts` (W17/W18/W19) — the single home for: formatting an instant, formatting a date-only string **without constructing a `Date`**, month-grid day enumeration, `isAllDay` range labeling ("Jul 16 – Jul 20", inclusive), and the cabin-time echo.
2. Month view: header with month/year steppers, a grid, events placed by day. All-day and multi-day events pin above timed ones. Fetch window = visible month ± 1 month (W14), refetched on navigation.
3. Day detail panel for the selected date, listing that day's events.
4. Create/edit event form: title, notes, **all-day toggle**, start/end. Toggling all-day swaps between `<input type="date">` and `<input type="datetime-local">` and **converts the held values** so the submitted shape always matches `isAllDay` (W15) — mixing shapes is a server 400.
5. Timezone labeling + cabin-time echo (W18).
6. Delete behind confirm. Events created here are owned by the acting admin; admins may edit or delete **any** event (the server allows it) — the list shows `creatorDisplayName` so an admin knows whose event they are changing.
7. Client-side validation mirroring the server: title 1–200, notes ≤ 5000, timed `start < end`, all-day `start ≤ end`.

**Tests (the priority area):** an all-day event round-trips as date-only strings with an inclusive end and **never shifts a day** (asserted at several browser timezones via `TZ`, including UTC−11 and UTC+13); a date-only string is never passed to `new Date`; timed events serialize to correct UTC instants across **both 2026 DST transitions**; toggling all-day rewrites the payload shape; the range query sends `start`/`end` and stays within 366 days; a multi-day event appears on every day it spans in the grid; month navigation refetches.

**Gate:** §5 + browser check (create one all-day and one timed event, confirm both render on the right days and survive a reload).

### Phase 7 — Knowledge base: categories and article lists

**Steps:**

1. Categories list: title, `sortOrder`, article count; create/rename; move up/down; delete behind confirm.
2. `CATEGORY_NOT_EMPTY` (409) → a specific message ("Move or delete this category's articles first"), not a generic failure.
3. Category view: articles with **status badges** (Draft/Published) — admins see both (the server returns both for admins); move up/down; delete behind confirm.
4. "New article" (W21): title + category → creates a `draft` → routes to the editor.

**Tests:** category CRUD hits the right endpoints; `CATEGORY_NOT_EMPTY` renders its specific guidance; the article list shows both statuses with badges; "New article" issues a create with `status: 'draft'` and navigates to the returned id; delete requires confirmation.

**Gate:** §5.

### Phase 8 — The article block editor

The centerpiece. Everything else exists to support this screen.

**Steps:**

1. Editor shell: title, category selector, **Draft/Published** toggle, Save, and a dirty indicator. Loads the full article (blocks + `updatedAt`).
2. Block list with per-block: **Move up / Move down** (W20), Delete (confirmed), and a focused editor for that block's type.
3. Add-block menu appending: Heading, Paragraph, Bullet list, Photo, Video. Every new block gets a `crypto.randomUUID()` id (W-block ids must be stable UUIDs, unique within the article).
4. Block editors:
   - **Heading** — single-line, ≤ 200
   - **Paragraph** — textarea, ≤ 10,000, no formatting toolbar (blocks carry no inline formatting)
   - **Bullets** — one input per item, add/remove/reorder, 1–100 items, each ≤ 500
   - **Image** — the W24 pipeline with progress, preview from the transient `url`, optional caption ≤ 300
   - **Video** — URL-or-ID input (W26), `youtube-nocookie` preview, optional caption
   - **Unknown** — read-only, preserved (W23)
5. `utils/image.ts` (W24) and `features/articles/upload.ts` (presign → PUT → key).
6. Save: strip every transient `url` (W25), validate the whole article against the mirrored zod schema client-side, then `PATCH` with `updatedAt`. On `409 STALE_ARTICLE` run the W16 flow.
7. Dirty guard (W22): in-app navigation confirm + `beforeunload`, and `Cmd/Ctrl+S` to save.

**Tests:** adding one of each block type produces a valid article the mirrored schema accepts; ids are UUIDs and unique; move up/down reorders and preserves ids; delete removes only the target; an **unknown block round-trips byte-identical** through load → unrelated edit → save; **no write payload contains `url`**; a 409 shows the reload/copy prompt and never silently overwrites; oversize and disallowed image types are rejected before any presign call; the presigned `Content-Length` equals the bytes actually PUT; YouTube extraction handles all four URL shapes plus a bare id and rejects junk; the dirty guard fires on navigation with unsaved changes.

**Gate:** §5 + browser check: build a real article containing all five block types **including a genuine image upload to S3**, publish it, reload, and confirm the image renders from a fresh presigned URL. Then delete the test article and its S3 object.

### Phase 9 — Hardening, review, deployment

**Steps:**

1. **Full §7 checklist review of the whole codebase** — a fresh pass, as if reviewing a stranger's PR.
2. Security sweep, each item verified by grep and/or a test, results recorded at the bottom of this file:
   - No `localStorage` anywhere; access token never in React state, storage, or the DOM.
   - No `console.*` outside the logging module; no announcement/quick-tip/temp-password value ever passed to it.
   - No `VITE_` variable other than the API base URL (W36); `dist/` grepped for the string `AWS`, `SECRET`, and the JWT to prove nothing leaked into the bundle.
   - Every mutating request body matches its documented field set exactly (W11).
   - Every destructive action is confirmed first.
   - `.env.local` never committed; `.env.example` current.
   - **S3 bucket CORS** on `bearlake-media-prod` is currently `AllowedOrigins: ["*"]`, which is why the browser→S3 PUT (W24) worked from `localhost` during Phase 8 and why the move to a Vercel domain will not break it. This is **not** an access-control hole — the bucket has Block Public Access on and every read and write requires a presigned URL, so the signature is what authorizes, not the origin. Narrow it anyway to the Vercel production origin plus `http://localhost:5173`: it costs one command and removes a needless allowance.
3. Run the full suite; append a coverage table mapping tests to this plan's risk areas (dates, auth/session, block round-trip, credential handling, concurrency).
4. Accessibility pass: every input labeled; modals trap and restore focus; the block list is fully keyboard-operable; visible focus rings; `aria-live` for save/upload status. Verified by keyboard-only navigation in the browser check.
5. Production build check: `npm run build` then `npm run preview` against the deployed API; confirm no console errors and a reasonable bundle size.
6. **Deployment (Vercel, W34):**
   - Add a checked-in `vercel.json` with a catch-all rewrite to `/index.html`, so a deep link like `/knowledge/articles/:id` is served the SPA rather than a 404. Do not rely on framework auto-detection for this — it is one file and it makes the behavior explicit and reviewable.
   - New Vercel project pointing at this repo, **root directory `bearlake-web`** (the repo holds three independent apps; without this Vercel builds the wrong thing).
   - Pin the Node version the way Vercel actually reads it — add `engines.node` to `package.json` rather than assuming `.node-version` is honored — and confirm the build log reports Node 22. W10 currently claims `engines` is already set; it is not, so this closes that drift too.
   - Set `VITE_API_BASE_URL` (Production scope) to the deployed API's `/api/v1` URL.
   - **Turn off Git preview deployments** (W35): they cannot reach the API, so they would only ever render the login screen.
7. **Set `WEB_ORIGIN`** on the **API service in Railway** to the Vercel production domain, and redeploy the API (W35) — without this, every browser request is blocked by CORS. Verify from the deployed web app, not with `curl`: CORS is enforced by browsers, so a passing `curl` proves nothing here.
8. Production smoke test against the deployed pair: admin login → forced-change gate (if applicable) → create/edit/delete one of each resource → article with a real uploaded image → user create + temp password modal → sign out. Clean up test data. Save the transcript to `docs/`.
9. Tag `web-v1`.

**Gate:** all of the above recorded as checked in this file, suite green, smoke transcript committed.

**Status: complete (2026-08-10).** Results recorded in §10; smoke transcript at
`docs/web-deploy-smoke-2026-08-10.md`. Live at <https://bearlake-web.vercel.app>.

---

## 7. Per-phase review checklist

Applied at every phase gate (step 5 of §5):

- [ ] No business logic in components; API calls only through `api/endpoints.ts` (no scattered `fetch`).
- [ ] Request bodies contain exactly the documented fields (W11); no `Partial<Entity>` shortcuts.
- [ ] All date handling goes through `utils/dates.ts`; no `new Date(dateOnlyString)`; no numeric date arithmetic.
- [ ] No `localStorage`; access token never persisted or rendered.
- [ ] No credential, announcement body, quick-tip body, or temp password reachable by `console` or any error path.
- [ ] Every destructive action confirms first; every API error surfaces something actionable.
- [ ] Inputs labeled; modals trap/restore focus; interactive elements are real `<button>`/`<a>` and keyboard-operable.
- [ ] `strict` TypeScript satisfied without `any`, convenience `as` casts, or `!`.
- [ ] New tests fail if the feature is broken (spot-check by reverting one behavior).
- [ ] Spec cross-check: re-read the relevant spec/`CLAUDE.md` section; confirm no invented screens, fields, or flows.

---

## 8. Skills and MCP servers to use

Flagged per the request; these change how the work gets verified, not what gets built.

**Use routinely:**

- **`claude-in-chrome` (MCP)** — the highest-value tool for this app and the backbone of W8. At each phase gate it drives the real UI (click, type, upload), reads **console messages** and **network requests**, and captures screenshots. This is how a browser-only bug (a CORS failure, a 400 from a stray field, an image that renders as a broken icon) gets caught before it reaches you. It replaces an automated E2E stack we deliberately are not adding.
- **`run` skill** — the standard way to launch and drive the app when verifying a change works for real rather than only in tests.
- **`/code-review`** — run on the working diff at each phase gate before opening the PR. `/code-review ultra` is worth it for **Phase 2 (auth/session)** and **Phase 8 (editor)**, the two phases where a subtle bug is most costly.
- **`/security-review`** — run on **Phase 2** (token storage, refresh, gates) and **Phase 5** (temp-password handling) specifically.

**Use situationally:**

- **`/simplify`** — after Phase 8, when the editor's block components have accumulated and duplication is easiest to see.
- **Vercel CLI** — Phase 9 only, for the web app's own deploy: `vercel link`, `vercel env`, `vercel deploy --prod`, and build logs. The dashboard is fine too; the CLI is just faster to drive and leaves a transcript.
- **Railway CLI agent tooling** — still relevant after W34, because the **API** stays on Railway: Phase 9 sets `WEB_ORIGIN` and redeploys it there. Running `railway setup agent` installs Railway's skills and MCP server (deployments, logs, status, docs), which makes that step and any log-reading easier than raw CLI parsing.
- **`fewer-permission-prompts`** — worth running once early if permission prompts on `npm`/`vite` commands become a drag.
- **AWS CLI** (already authenticated) — needed in Phase 8/9 to clean up test S3 objects, to inspect the bucket's CORS configuration if a browser upload is blocked, and to narrow that CORS rule in the Phase 9 security sweep.

**Explicitly not applicable:** `dataviz` (no charts in this app), `artifact-design`/`artifact-diagramming` (those govern Claude Artifacts, not a deployed React app — reaching for them here would be a category error).

**Subagents:** not needed by default. If a phase requires broad codebase search (e.g. the Phase 9 sweep across every file), an `Explore` agent is a reasonable fan-out — but only on request.

---

## 9. Execution notes

- One branch per phase, PR to `master` at the end of each, matching the server workflow.
- Phases are strictly ordered; each commit leaves the suite green.
- Anything discovered mid-build that contradicts this plan → stop, amend §2 with the new decision and its rationale, then continue. The plan stays truthful to what was built.
- The API is authoritative and already deployed. If the web app needs a capability the API lacks, that is a **server change first** (and a server plan amendment) — never a special-cased client workaround, and never an endpoint that exists only for the web app.
- Cross-app implications to carry into the **iOS** plan: the block schema mirror (W5) is the same contract Swift models must match; W15's date-only wire format and W16's `updatedAt` concurrency apply identically there.

---

## 10. Phase 9 verification record

Completed 2026-08-10. Production smoke transcript: `docs/web-deploy-smoke-2026-08-10.md`.

### Security sweep (Phase 9 step 2)

| Check | Result |
|---|---|
| No `localStorage` anywhere | **Pass.** Only two mentions in `src/`, both comments stating it is *not* used. Confirmed live in production: `localStorage.length === 0`. |
| Access token never persisted or rendered | **Pass.** Memory-only module variable; `sessionStorage` holds exactly one key, `bearlake.refreshToken`. |
| No `console.*` outside a logging module | **Pass.** Zero `console.*` calls in `src/` — the planned logging module was never needed. |
| No `VITE_` var other than the API base URL | **Fixed, then pass.** `getConfig()` passed the whole `import.meta.env` object, which Vite cannot statically replace, so it emitted **every** `VITE_*` — shipping `VITE_DEV_API_PROXY` into the production bundle. Now reads the single property; `dist/` greps clean. |
| `dist/` free of `AWS`, `SECRET`, JWT, bucket name, DB URL | **Pass.** 0 hits for each. |
| Mutating bodies match documented fields (W11) | **Pass.** All 21 call sites reviewed; every body is an exact literal or a typed `Create*`/`Update*` request. TypeScript's exact request types plus the server's `z.strictObject` make an extra key a compile error. |
| Every destructive action confirmed first | **Pass.** Every file issuing a delete/reset/deactivate also mounts `ConfirmDialog`; 9 feature files in total. |
| `.env.local` never committed; `.env.example` current | **Fixed, then pass.** `vercel link` appended a blanket `.env*` to `.gitignore`, which would have made the checked-in `.env.example` un-addable. Replaced with explicit entries plus `!.env.example`. The `VERCEL_OIDC_TOKEN` the CLI wrote lives only in gitignored `.env.local`. |
| S3 bucket CORS | **Narrowed.** Was `AllowedOrigins: ["*"]`; now the three Vercel aliases plus `localhost:5173/4173`. Not an access-control hole either way (private bucket, presigned-only), but the allowance was needless. Validated by a real upload after narrowing. |

### Accessibility pass (Phase 9 step 4)

| Check | Result |
|---|---|
| Every input labeled | **Fixed, then pass.** All controls use `id` + `<label htmlFor>` or a wrapping `<label>`, except the hidden file input in `AddBlockMenu`, which was an anonymous control in the a11y tree. Given `aria-label` and `tabIndex={-1}` so the "+ Photo" button is the single keyboard stop. |
| Modals trap and restore focus | **Pass.** Covered by `Modal` tests since Phase 3 (focus trap, Escape, focus restoration to trigger). |
| Block list keyboard-operable | **Pass.** Move up/down/delete are real `<button>`s with `aria-label`s; no drag-and-drop (W20). |
| Visible focus rings | **Pass.** `:focus-visible` outline on inputs, textareas, selects, buttons, links. |
| `aria-live` for save/upload status | **Fixed, then pass.** Upload had `role="status"`; **save had no announcement at all** — the only success cue was the "Unsaved changes" indicator disappearing, invisible to a screen-reader user. Added a polite live region announcing "Article saved.", with a regression test. |

### Test coverage against this plan's risk areas (Phase 9 step 3)

251 tests across 32 files, all passing.

| Risk area | Where it is covered |
|---|---|
| Dates / timezones | `test/utils/dates.test.ts` — both 2026 DST transitions; all-day round-trips asserted invariant at UTC+13, UTC−11, `America/Denver`, UTC; month-grid enumeration; `getEventsFetchWindow` inside the 366-day cap. `EventFormModal.test.tsx` — DST-correct UTC serialization, all-day toggle rewriting the payload shape. |
| Auth / session | `test/auth/*` — login stores tokens, failed login stores nothing, member rejected *and* logged out, `mustChangePassword` gate blocks navigation, boot restore both ways, and a suite-wide spy asserting `localStorage` is never written. |
| Block round-trip | `blocks.test.ts` — unknown block preserved field-for-field, malformed known block rejected rather than reclassified. `ArticleEditorPage.test.tsx` — unknown block round-trips byte-identical through an unrelated edit and save. |
| Credential handling | `UsersPage.test.tsx` — temp password shown once, cleared on dismiss, copied exactly, and explicitly asserted absent from `sessionStorage`, `localStorage`, the URL, and `console`. Re-verified live in production (smoke step 18). |
| Concurrency | `ArticleEditorPage.test.tsx` — 409 `STALE_ARTICLE` shows the reload/copy prompt, never silently overwrites; Reload refetches; "Copy my changes" copies the local blocks JSON then reloads. |
| Image pipeline | `upload.test.ts` — disallowed type and oversize rejected *before* any presign call; presigned `Content-Length` equals bytes actually PUT. `image.test.ts` — downscale math, HEIC passthrough. No write payload contains `url` (asserted in the editor tests). |
| YouTube parsing | `youtube.test.ts` — all four URL shapes, bare id, whitespace, and junk rejection. |

### Deviation from Phase 9 step 6

Git integration was **not** connected; deploys are CLI-driven (`vercel deploy --prod` from `bearlake-web/`). This satisfies W35 by construction — with no Git connection there are no preview URLs for the API's exact-match CORS to refuse. Trade-off: merging to `master` does not auto-deploy. Connecting Git later is a dashboard toggle, at which point previews must be disabled per W35.
