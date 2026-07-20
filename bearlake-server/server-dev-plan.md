# Bear Lake Server — Development Plan

**Scope:** `bearlake-server/` only. Express + TypeScript + MySQL, deployed on Railway.
**Sources of truth:** `CLAUDE.md`, `docs/bear-lake-tech-spec.md`. Where those documents left a decision open, this plan closes it (§2). Development is execution of this plan; deviations require updating this document first.

---

## 1. Goal

A complete, tested, deployed `/api/v1` implementing:

- Auth: login, refresh rotation, logout, forced/voluntary password change, `/me`
- Admin user management: create, list, patch, reset-password (temp password returned exactly once)
- Events CRUD with a required-range query and creator/admin ownership rules
- Announcements (admin-write, cursor-paginated)
- Quick tips (admin-write)
- Knowledge base: categories + block-based articles with draft gating, optimistic concurrency, presigned image URL resolution
- S3 presigned uploads (admin)
- Security posture per spec §6: server-side authorization everywhere, no credential/content leakage into logs

---

## 2. Decision record

Every previously open or unspecified choice, resolved. These are final for v1.

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | First-admin bootstrap | CLI script `npm run seed:admin -- <email> <displayName>`. Generates a temp password, prints it once to stdout, creates admin with `mustChangePassword = true`. Idempotent: refuses if any admin already exists. | Keeps credentials out of migrations and env history; same temp-password flow as normal provisioning. |
| D2 | Category deletion with articles | Block with `409 CATEGORY_NOT_EMPTY`. | Spec recommendation; cascade deletion of written content is unrecoverable. |
| D3 | Password hashing | `bcrypt`, cost 12. | Boring, ubiquitous, meets spec. |
| D4 | Access token | JWT, HS256, secret from `JWT_SECRET`, **30 min** lifetime. Payload: `{ sub }` only. | Middle of spec's 15–60 range. |
| D5 | Fresh user on every request | Auth middleware loads the user row from MySQL on each authenticated request; role, `isActive`, `mustChangePassword` are never read from the JWT. | Dozens of users — one indexed PK read is free, and deactivation/role changes take effect immediately instead of at token expiry. |
| D6 | Refresh token | 256-bit `crypto.randomBytes`, base64url. Stored as SHA-256 hex hash. **60-day** lifetime, rotating on use. One lifetime for both clients — web's `sessionStorage` already bounds practical exposure. | SHA-256 is fine here (high-entropy random input, unlike passwords). |
| D7 | Refresh reuse = theft | On refresh: token not found → 401. Found but revoked → revoke **all** tokens for that user, 401. Found and valid → transactionally revoke old, insert new. | Spec §3.3. |
| D8 | `mustChangePassword` gate | Applies to bearer-authenticated routes. Allowed: `POST /auth/change-password`, `GET /me`. Everything else → `403 { code: "PASSWORD_CHANGE_REQUIRED" }`. `/auth/refresh` and `/auth/logout` authenticate via refresh token, not bearer, and are unaffected. | Spec §5.3; refresh must keep working so the change-password call itself can't be stranded by an expired access token. |
| D9 | Change-password contract | `{ currentPassword, newPassword }` — current password **always** required, including the forced flow (the client holds the temp password in memory from login). Server verifies current, enforces rules, revokes all refresh tokens, issues a fresh token pair in the response. | Defense in depth: a stolen access token alone cannot take over the account. |
| D10 | Password rules | ≥ 12 chars, ≤ 128; no composition rules; case-insensitive reject against a checked-in `common-passwords.txt` (top-100k list filtered to length ≥ 12); new must differ from current. | Spec §6.2. |
| D11 | Login rate limiting | Hand-rolled in-memory fixed-window: 10 failures / email / 15 min, 30 failures / IP / 15 min → `429 RATE_LIMITED`. Counters reset on success. Single Railway instance makes in-memory acceptable; recorded as a known limitation. | No extra dependency; boring. |
| D12 | Login response indistinguishability | Unknown email runs a dummy bcrypt compare against a fixed hash before returning the same generic `401 INVALID_CREDENTIALS`. | Prevents both message- and timing-based account enumeration. |
| D13 | IDs | `crypto.randomUUID()`, stored `CHAR(36)`. | No uuid dependency. |
| D14 | Timestamps in MySQL | `DATETIME(3)`, always UTC. `mysql2` configured with `dateStrings: true`; a single mapper module converts DB strings ↔ ISO-8601 `Z` strings. No `Date` timezone ambiguity anywhere. | One conversion point, per spec. |
| D15 | All-day event storage | Same `starts_at`/`ends_at` columns, time component `00:00:00.000`, interpreted as **calendar dates** — never timezone-converted. API: when `isAllDay` is true, clients send and receive `startsAt`/`endsAt` as date-only strings (`"2026-07-19"`); serializer/validator enforce the two shapes. `endsAt` is the **last day, inclusive** (a Jul 16–20 stay is `startsAt: 2026-07-16, endsAt: 2026-07-20`). | Date-only semantics per spec §3.6 without a second pair of columns. |
| D16 | Range query semantics | `GET /events?start&end` (both required, ISO instants, `start < end`, window ≤ 1 year). Timed overlap: `starts_at < :end AND ends_at > :start`. All-day overlap: event's date range vs. the window's date range in `America/Denver`, end-inclusive. | Returns events that start before or end after the window; the classic off-by-one is a named test target. |
| D17 | Event validation | `title` 1–200 chars; `notes` ≤ 5000, nullable; timed: `startsAt < endsAt`; all-day: `startDate ≤ endDate`. | |
| D18 | Announcements pagination | Keyset cursor on `(posted_at DESC, id DESC)`, cursor = base64url of `postedAt|id`. `limit` default 20, max 50. `postedAt` set server-side at creation, not editable; PATCH edits `body` only. | |
| D19 | Sort orders | `sortOrder` int on quick tips, categories, articles. Optional on create (default `max + 1` within scope); PATCH accepts it. No dedicated reorder endpoint in v1. | |
| D20 | Block validation | zod discriminated union exactly matching the spec schema. `id` must be UUID and unique within the article. Caps: 200 blocks/article; heading ≤ 200 chars; paragraph ≤ 10,000; bullets ≤ 100 items × 500 chars, ≥ 1 item; caption ≤ 300; image `key` must match `^articles/[0-9a-f-]{36}/[0-9a-f-]{36}$`; `videoId` must match `^[A-Za-z0-9_-]{11}$`. **Unknown block types → 400** — the server deploys first, so it always knows the full schema. | Strict at the boundary; clients tolerate unknowns, the server defines them. |
| D21 | `schemaVersion` | Server-stamped constant `CURRENT_BLOCK_SCHEMA_VERSION = 1` on every write; client-supplied value ignored. | |
| D22 | Article list vs. detail | `GET /info/categories/:id/articles` returns summaries (`id, categoryId, title, status, sortOrder, updatedAt`) without blocks. `GET /info/articles/:id` returns the full article with blocks. | Lists stay light; presigning happens only where images are rendered. |
| D23 | Optimistic concurrency | `PATCH /info/articles/:id` requires `updatedAt` (ISO, millisecond precision). String-equal against stored value; mismatch → `409 STALE_ARTICLE`. Applied to articles only, per spec. | |
| D24 | Presigned image URLs | Article detail responses add a transient `url` field to each image block (key retained). Presigned GET, 15-min expiry. | |
| D25 | Upload presign | `POST /uploads/presign` body: `{ articleId, contentType, contentLength }`. Article must exist (editors create the draft before first upload — client-side implication, noted for the client plans). Allowlist: `image/jpeg`, `image/png`, `image/heic`. Cap: 10 MB. Returns `{ key, uploadUrl }` — presigned PUT, 10-min expiry, with `ContentType` and `ContentLength` signed so S3 rejects mismatches. | Signing content-length on PUT gives a hard size cap without switching to POST policies. |
| D26 | Logging | Hand-rolled request logger: method, path, status, duration, caller user id. **No request or response bodies, ever, on any route.** Error logs carry stack traces server-side only. | Never logging bodies anywhere makes the §6.5 redaction list unnecessary — there is nothing to redact. |
| D27 | CORS | `cors` package, allowlist from `WEB_ORIGIN` env (comma-separated). No credentials mode needed (bearer tokens, no cookies). | |
| D28 | Migrations | Hand-rolled runner: ordered `NNN_name.sql` files in `src/db/migrations/`, applied filenames recorded in `_migrations`. Runs automatically on server boot before `listen()`; also runnable via `npm run migrate`. MySQL DDL auto-commits — files must be single-statement-safe and forward-only; no down migrations. | Single instance on Railway → boot-time migration is safe and removes a deploy step. |
| D29 | Test stack | `vitest` + `supertest` against the Express app (no listening socket). Dedicated test database (`DB_NAME_TEST`), migrated fresh per run, tables truncated between tests. Integration tests at the HTTP layer are primary; unit tests only for pure logic (overlap math, cursors, password rules). | Tests exercise validation → middleware → service → DB exactly as production does. |
| D30 | Config | Fail-fast env validation at boot via a zod schema in `src/config.ts`. Reads `MYSQL_URL` if set, else discrete `MYSQLHOST/MYSQLPORT/MYSQLUSER/MYSQLPASSWORD/MYSQLDATABASE` (Railway's names). | |
| D30a | S3 config strictness (amended in Phase 0) | `AWS_*`/`S3_*` are required **only when `NODE_ENV=production`**; elsewhere they default to empty. `s3Service` (Phase 7) throws a clear configuration error if constructed without them. | As originally written, every var was required unconditionally, which prevented `npm run dev` from booting during Phases 1–6 — work that never touches S3. Putting placeholder credentials in `.env.example` would have hidden the problem rather than solved it. A production deploy that cannot presign is still a hard boot failure. |
| D31 | Error taxonomy | Typed `ApiError` classes → one error middleware maps to `{ error: { code, message } }`. Codes: `VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `UNAUTHENTICATED`, `FORBIDDEN`, `PASSWORD_CHANGE_REQUIRED`, `ACCOUNT_DISABLED`, `NOT_FOUND`, `STALE_ARTICLE`, `CATEGORY_NOT_EMPTY`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `INTERNAL`. Unknown errors → 500 `INTERNAL` with generic message; details logged server-side only. | |
| D32 | JSON body limit | `express.json({ limit: '1mb' })`. Articles are text + keys; nothing legitimate approaches 1 MB. | |

**Dependency list (final — this plan's approval is the "ask before adding"):**

- Runtime: `express`, `zod`, `mysql2`, `bcrypt`, `jsonwebtoken`, `cors`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`
- Dev: `typescript`, `tsx`, `vitest`, `supertest`, `eslint`, `typescript-eslint`, `@types/express`, `@types/bcrypt`, `@types/jsonwebtoken`, `@types/cors`, `@types/supertest`, `@types/node`

Nothing else without amending this plan.

---

## 3. Environment variables

Documented in `.env.example` (kept current; `.env` gitignored):

```
PORT=                      # Railway-provided
MYSQL_URL=                 # Railway-provided (or the discrete MYSQL* vars)
DB_NAME_TEST=bearlake_test # local/test only
JWT_SECRET=                # ≥ 32 chars, random
ACCESS_TOKEN_TTL_MIN=30    # optional override
REFRESH_TOKEN_TTL_DAYS=60  # optional override
WEB_ORIGIN=                # comma-separated CORS allowlist
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_REGION=
S3_BUCKET=
```

---

## 4. Project structure (target)

```
bearlake-server/
  package.json  tsconfig.json  eslint.config.js  vitest.config.ts
  .env.example  common-passwords.txt
  src/
    index.ts            — boot: config → migrate → listen
    app.ts              — express app assembly (importable by tests)
    config.ts           — zod-validated env
    routes/             — auth.ts users.ts events.ts announcements.ts
                          quickTips.ts info.ts uploads.ts
    controllers/        — one per resource; thin
    services/           — authService, userService, eventService, …
    db/
      pool.ts           — mysql2 pool (dateStrings: true)
      mapper.ts         — snake_case↔camelCase + DATETIME↔ISO, the one place
      migrate.ts        — runner
      migrations/001_init.sql
      queries/          — one module per table, parameterized SQL only
    middleware/         — authenticate.ts requireAdmin.ts
                          passwordChangeGate.ts errorHandler.ts
                          requestLogger.ts rateLimit.ts
    schemas/            — zod: auth, users, events, announcements,
                          quickTips, categories, articles (blocks), uploads
    types/              — domain types, ApiError classes, error codes
    scripts/seedAdmin.ts
  test/
    helpers/            — test app, db reset, auth fixtures (login helpers
                          returning tokens for admin / member A / member B)
    auth.test.ts users.test.ts events.test.ts announcements.test.ts
    quickTips.test.ts info.test.ts uploads.test.ts security.test.ts
    unit/               — overlap, cursor, password-rules, mapper
```

---

## 5. Phase gate (applies to every phase)

A phase is complete only when all of the following pass, in order:

1. `npm run lint` — zero errors
2. `npx tsc --noEmit` — zero errors (strict)
3. `npm test` — all tests green, including all prior phases'
4. **Self-review against the checklist in §7** for every file touched
5. Manual smoke test of the phase's endpoints with `curl` against `npm run dev` (happy path + one auth failure + one validation failure per endpoint)
6. Commit with a message naming the phase

Do not start phase N+1 with phase N's gate unmet.

---

## 6. Phases

### Phase 0 — Scaffold and skeleton

**Steps:**

1. `npm init`; install the §2 dependency list exactly.
2. `tsconfig.json`: `strict: true`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `target: "ES2022"`, `outDir: "dist"`. `"type": "module"` in package.json.
3. Scripts: `dev` (tsx watch src/index.ts), `build` (tsc), `start` (node dist/index.js), `test` (vitest run), `lint`, `migrate` (tsx src/db/migrate.ts), `seed:admin` (tsx src/scripts/seedAdmin.ts).
4. ESLint flat config with typescript-eslint recommended; add `no-console` (logger module excepted) to keep stray debug logging out.
5. `src/config.ts`: zod env schema per §3; process exits with a clear message listing missing vars.
6. `src/types/errors.ts`: `ApiError` base (status, code, message) + one subclass per D31 code.
7. `src/middleware/errorHandler.ts`: `ApiError` → its shape; `ZodError` → 400 `VALIDATION_ERROR` with flattened field summary in `message`; anything else → 500 `INTERNAL`, generic message out, stack logged.
8. `src/middleware/requestLogger.ts` per D26.
9. `src/app.ts`: json body limit (D32), CORS (D27), request logger, `/api/v1` router with `GET /health` → `{ ok: true }`, 404 fallback → `NOT_FOUND`, error handler last.
10. `src/index.ts`: config → (migrations, Phase 1) → listen on `PORT`.
11. `.env.example`, `.gitignore` (`.env`, `dist/`, `node_modules/`).
12. Vitest config + first test: `GET /api/v1/health` 200; unknown path → 404 shape; malformed JSON body → 400 shape.

**Tests:** the three above.
**Gate:** §5.

### Phase 1 — Database layer and migrations

**Steps:**

1. `src/db/pool.ts`: mysql2/promise pool from config; `dateStrings: true`; `connectionLimit: 10`.
2. `src/db/migrate.ts` per D28. Creates `_migrations (filename PK, applied_at)`; applies pending files in lexicographic order; logs each filename (nothing else).
3. `001_init.sql` — all tables, InnoDB, utf8mb4, snake_case, `CHAR(36)` PKs, `DATETIME(3)` timestamps:
   - `users`: unique index on `email` (stored lowercased/trimmed); `role ENUM('admin','member')`; `must_change_password`, `is_active` booleans; nullable `last_login_at`.
   - `refresh_tokens`: unique `token_hash`; index `(user_id)`; FK → users; `expires_at`, nullable `revoked_at`.
   - `events`: FK `created_by` → users; `is_all_day`; index `(starts_at)`, index `(ends_at)`.
   - `announcements`: FK `created_by`; index `(posted_at, id)`.
   - `quick_tips`: FK `created_by`; `sort_order INT`.
   - `info_categories`: `sort_order INT`.
   - `info_articles`: FK `category_id` → info_categories (**RESTRICT** — D2 enforced at DB level too), FK `created_by`; `blocks JSON`; `schema_version INT`; `status ENUM('draft','published')`; `sort_order INT`; index `(category_id, sort_order)`.
4. `src/db/mapper.ts` (D14): `rowToApi` / `apiToRow` helpers — the only place snake_case↔camelCase and `DATETIME(3)`↔ISO-`Z` conversion happen.
5. Query modules in `src/db/queries/` as tables become needed (started here with `users` + `refreshTokens`, extended per phase). Parameterized statements exclusively; every statement written here, never inline in services.
6. Test harness: `test/helpers/db.ts` — connects to `DB_NAME_TEST`, drops + re-migrates once per run, truncates all tables (FK checks off) between test files; `test/helpers/app.ts` builds the app once.

**Tests:** migration runner is idempotent (run twice, second is a no-op); mapper round-trips a row with millisecond timestamps and null fields (unit).
**Gate:** §5, plus: inspect `SHOW CREATE TABLE` output for every table against §2/spec entity definitions.

### Phase 2 — Auth core

The largest phase; everything else depends on it.

**Steps:**

1. `services/passwordService.ts`: bcrypt hash/verify (D3); rule checks (D10) including `common-passwords.txt` loaded once at boot into a `Set` (lowercased); temp-password generator — 20 chars, `crypto`, unambiguous alphabet (no `0O1lI`).
2. `services/tokenService.ts`: JWT sign/verify (D4); refresh token generate/hash (D6); DB-backed issue, rotate (transaction: revoke old + insert new), revoke-one, revoke-all-for-user.
3. `middleware/authenticate.ts` (D5): parse bearer → verify JWT → load user by `sub` → 401 `UNAUTHENTICATED` (missing/invalid/expired token or missing user) / 403 `ACCOUNT_DISABLED` (`isActive = false`) → attach `req.user`.
4. `middleware/passwordChangeGate.ts` (D8) — applied globally after `authenticate` with the two allowed routes exempted.
5. `middleware/requireAdmin.ts`: 403 `FORBIDDEN`.
6. `middleware/rateLimit.ts` (D11) applied to `POST /auth/login` only.
7. `POST /auth/login`: normalize email; dummy-compare on unknown email (D12); reject inactive users with the same generic 401; update `last_login_at`; return `{ accessToken, refreshToken, user }` where `user` = `{ id, displayName, email, role, mustChangePassword }`.
8. `POST /auth/refresh`: body `{ refreshToken }`; D7 semantics exactly. Refresh for a now-inactive user → revoke family, 401.
9. `POST /auth/logout`: body `{ refreshToken }`; revoke it; 204. Idempotent — unknown/already-revoked token still 204.
10. `POST /auth/change-password` (D9): verify current; enforce D10 + differs-from-current; update hash; clear `mustChangePassword`; revoke all refresh tokens; return fresh token pair.
11. `GET /me`: `req.user` in the login `user` shape.
12. `scripts/seedAdmin.ts` (D1).

**Tests (the core of test priorities 7 & 8):**

- Login: success; wrong password and unknown email produce byte-identical response bodies and status; inactive user likewise; `last_login_at` updated.
- Rate limit: 11th failure for one email → 429; counter clears on success; per-IP limit independently.
- Refresh: rotation issues new + revokes old; old token reuse → 401 **and** every token for that user revoked (the fresh one stops working too); expired token → 401; deactivated user's valid refresh token → 401.
- Gate: user with `mustChangePassword` gets 403 `PASSWORD_CHANGE_REQUIRED` from a representative mutating and reading route, while `/me` and change-password succeed.
- Change-password: wrong current → 401-shape failure; < 12 chars, common password, same-as-current → 400; success revokes all prior refresh tokens on other "devices", returns a working pair, clears the flag.
- Seed script: creates admin; second run refuses.
- **Credential leakage:** capture logger output for a full login + change-password + seed flow; assert no password, hash, or token substring appears.
- Unit: password rules; temp generator length/alphabet.

**Gate:** §5.

### Phase 3 — User management (admin)

**Steps:**

1. `GET /users` (admin): all users, no `passwordHash` in any response shape — enforce via an explicit serializer, not omission-by-luck.
2. `POST /users` (admin): `{ displayName, email, role }`; normalized email; duplicate (case-insensitive) → 409; generates temp password; response `{ user, temporaryPassword }` — the **only** place it exists (with reset below).
3. `PATCH /users/:id` (admin): `displayName`, `role`, `isActive` only — email and password not patchable. Setting `isActive: false` revokes all refresh tokens. Guard: an admin cannot deactivate or demote **themselves** (prevents locking the family out; the other admin can do it).
4. `POST /users/:id/reset-password` (admin): new temp password, `mustChangePassword = true`, revoke all refresh tokens, return `{ temporaryPassword }`.

**Tests (priority 7):** member calling each route → 403; unauthenticated → 401; duplicate email differing only by case → 409; created user can log in with temp password and is gated until change; deactivation kills an in-flight session (existing access token now 403 `ACCOUNT_DISABLED`, refresh 401); reset revokes prior sessions; self-demotion/self-deactivation blocked; no response anywhere contains `passwordHash`; temp password appears in exactly the two documented responses and never in log output.

**Gate:** §5.

### Phase 4 — Events

**Steps:**

1. `schemas/events.ts` (D15/D17): discriminated on `isAllDay` — timed variant takes ISO instants, all-day takes `YYYY-MM-DD` strings; cross-field checks.
2. `services/eventService.ts` + `db/queries/events.ts`: overlap query per D16. Timezone day-boundary math for all-day comparison lives in **one** utility (`services/dateRange.ts`) with `America/Denver` handling via `Intl` — no date libraries, no `+ 86400`.
3. `GET /events?start&end`: both required else 400; `start < end`; window ≤ 366 days. Response events serialize per D15 (date-only strings when all-day).
4. `POST /events` (any authenticated user): `createdBy` = caller. Response includes `createdBy` and `creatorDisplayName` (joined) so clients can render ownership.
5. `GET /events/:id`.
6. `PATCH /events/:id` / `DELETE /events/:id`: creator or admin, else 403. PATCH revalidates the full resulting event (can't patch `endsAt` before `startsAt`; can toggle `isAllDay` with the matching field shapes).
7. 404 before 403 ordering: nonexistent event → 404 regardless of caller.

**Tests (priorities 2 & 3):**

- Range: event entirely before window excluded; starts before/ends inside included; starts inside/ends after included; spans the whole window included; touching boundaries (ends exactly at `start`, starts exactly at `end`) **excluded** (half-open); missing params → 400.
- All-day: stored date-only; round-trips without shift; a Jul 16–20 all-day event is returned for a window covering only Jul 20 (inclusive end); events queried across a DST transition (2026-03-08, 2026-11-01) land on the correct days; all-day event does not leak into an adjacent-day window regardless of the window's UTC offset.
- Timed events spanning midnight and month boundaries appear in both relevant windows.
- Ownership: member A cannot PATCH/DELETE member B's event (403); admin can do both; creator can do both; unauthenticated → 401.
- Validation: `endsAt ≤ startsAt` → 400; mixed shapes (all-day with time-bearing strings) → 400.
- Unit: overlap predicate and Denver day-boundary utility, including DST cases.

**Gate:** §5.

### Phase 5 — Announcements and quick tips

**Steps:**

1. `GET /announcements?limit&cursor` (D18): any authenticated user; returns `{ items, nextCursor }`, `nextCursor` null at end; malformed cursor → 400.
2. `POST /announcements` (admin): `{ body }` 1–5000 chars; `postedAt` = now.
3. `PATCH /announcements/:id` (admin): `body` only. `DELETE` (admin).
4. Quick tips: `GET` (all users, ordered by `sortOrder, createdAt`); `POST`/`PATCH`/`DELETE` (admin); `body` 1–1000 chars; `sortOrder` per D19.

**Tests (priority 2 + pagination):** member write attempts → 403 on all six mutating routes; pagination walks 45 seeded announcements in stable order with no duplicates/gaps across pages, including ties on `postedAt`; cursor tampering → 400; quick tips ordering respected; **log-leakage check: announcement and quick-tip bodies never appear in captured log output** (spec §6.5 — they contain codes).

**Gate:** §5.

### Phase 6 — Knowledge base

**Steps:**

1. `schemas/articles.ts`: block union per D20; article create `{ categoryId, title (1–200), blocks, status, sortOrder? }`; patch = same fields optional **plus required `updatedAt`** (D23).
2. Categories: `GET /info/categories` (all users, ordered); `POST`/`PATCH` (admin, `title` 1–100, `sortOrder`); `DELETE` (admin, D2: any articles → 409 `CATEGORY_NOT_EMPTY`).
3. `GET /info/categories/:id/articles`: summaries (D22); members receive `status = 'published'` only, admins all — filtered in the SQL, keyed off `req.user.role`.
4. `GET /info/articles/:id`: full article; member requesting a draft → **404** (not 403 — don't confirm the draft exists); image blocks get transient `url` (D24) via `services/imageUrlService.ts`.
5. `POST /info/articles` (admin): stamps `schemaVersion` (D21); validates `categoryId` exists (else 400).
6. `PATCH /info/articles/:id` (admin): stale `updatedAt` → 409 `STALE_ARTICLE`; match → apply, return the new article (with fresh `updatedAt` and presigned URLs).
7. `DELETE /info/articles/:id` (admin).

**Tests (priorities 2 & 5 server-side):**

- Draft gating: member sees only published in lists; member GET of a draft → 404; admin sees both. Proven at API level with both roles.
- Concurrency: read → concurrent patch → second patch with stale `updatedAt` → 409; retry after reload succeeds; create→patch race on `updatedAt` millisecond equality.
- Category delete: empty deletes; non-empty → 409; after moving/deleting articles, delete succeeds.
- Blocks: valid article with all five types round-trips **structurally identical** (parsed comparison, not string — spec §11 note) with block ids and order preserved; unknown block type → 400; duplicate block ids → 400; every cap in D20 enforced; image key not matching the namespace pattern → 400.
- Presign resolution: image block responses carry both `key` and `url`; stored JSON in DB contains no `url` (assert directly against the DB row).
- Member/unauthenticated write attempts → 403/401 on all mutating routes.

**Gate:** §5.

### Phase 7 — Uploads

**Steps:**

1. `services/s3Service.ts`: S3 client from config; key generation `articles/{articleId}/{uuid}`; presigned PUT per D25; presigned GET per D24 (shared by Phase 6 — Phase 6 stubs this behind an interface so its tests don't need S3; wire the real one here).
2. `POST /uploads/presign` (admin): validate per D25 (article exists → else 404; content type allowlist → else 400; `contentLength` 1–10 MB → else 400/413).
3. Tests use the service behind its interface with a fake; one manual verification against a real bucket (below).

**Tests:** member → 403; bad content type → 400; oversize → 413 `PAYLOAD_TOO_LARGE`; nonexistent article → 404; key matches namespace pattern and is unique across calls; generated URL string contains signed `Content-Type`/`Content-Length` (inspect query params against the fake).
**Manual verification (gate item):** with real credentials in `.env`: presign → `curl -T` a real JPEG → 200; upload with wrong content type → S3 rejects; oversized declared length rejected at presign; GET presign renders the image in a browser; expired URL (wait/short-expiry) → 403 from S3.

**Gate:** §5 + the manual S3 checklist.

### Phase 8 — Hardening, full review, deployment

**Steps:**

1. **Full §7 checklist review of the entire codebase** — fresh pass, every source file, as if reviewing a stranger's PR.
2. Security sweep, each item verified by grep and/or a test, results recorded at the bottom of this file:
   - No string-concatenated SQL anywhere (`grep` for template literals in query modules).
   - Every route file: authentication present; admin/ownership middleware on every mutating route; cross-check against the spec's endpoint table line by line.
   - No `console.` outside the logger; logger provably body-free (existing leakage tests re-run).
   - `.env` never committed (`git log --all -- .env` empty); `.env.example` current.
   - Error responses: force a DB failure and a thrown TypeError in dev; confirm the client sees only `INTERNAL` shape.
   - `POST /auth/register` does not exist (test: 404).
2. Run the **full test suite** and map every test to spec §11's eight priorities in a short coverage table appended to this plan; any priority without a covering test gets one now.
3. Load `.env`-free boot check: start with each required var missing; confirm the fail-fast message.
4. Deployment to Railway:
   - Create project: MySQL plugin + Node service from `bearlake-server/` (root directory setting), build `npm run build`, start `npm start`.
   - Set env vars per §3 (generate `JWT_SECRET`; S3 bucket created with **Block Public Access on**, CORS on the bucket allowing PUT/GET from app origins).
   - First deploy → boot migrations run → `railway run npm run seed:admin` for the first admin.
   - Smoke test against production URL: health; seeded admin login → gate → change-password → full pass through one resource of each type (create event, announcement, quick tip, category, draft article with an uploaded image, publish it); verify member account created via API sees published-only.
5. Tag the commit `server-v1`.

**Gate:** all of the above recorded as checked in this file, suite green, production smoke test transcript saved to `docs/` — then the server is done and client work may begin.

---

## 7. Per-phase review checklist

Applied at every phase gate (step 4 of §5):

- [ ] Every new route: `authenticate` → gate → role/ownership check → zod-validated input → thin controller → service → typed errors. No logic in the route file.
- [ ] Every query parameterized; no interpolation.
- [ ] No secrets, tokens, passwords, or announcement/tip bodies can reach the logger from any code path added this phase.
- [ ] All timestamps flow through `mapper.ts`; no `new Date()` timezone assumptions; no numeric date arithmetic.
- [ ] Error paths return documented codes; nothing leaks internals (SQL messages, stacks, file paths).
- [ ] Response serializers are explicit allowlists of fields (no spreading DB rows into JSON).
- [ ] New tests fail if the feature is broken (spot-check by reverting one behavior mentally or actually).
- [ ] `strict` TypeScript satisfied without `any`, `as` casts of convenience, or `!`.
- [ ] Spec cross-check: re-read the relevant spec section; confirm no invented fields, routes, or behaviors.

---

## 8. Execution notes

- Phases are strictly ordered; each commit leaves the suite green.
- Anything discovered mid-build that contradicts this plan → stop, amend §2 with the new decision and rationale, then continue. The plan stays truthful to what was built.
- Client-facing implications recorded for the iOS/web plans: D9 (client retains current password in memory for the forced change), D15 (all-day date-only wire format, inclusive end), D25 (create draft article before first image upload), D18 (cursor pagination contract).
