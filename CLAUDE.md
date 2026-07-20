# Bear Lake Cabin App

A private app for an extended family to coordinate use of a shared vacation property at Bear Lake, Utah. Two core features: a **calendar/scheduling** system and a **knowledge base** of cabin instructions and reference information, plus an **announcements** feed on the home screen.

Audience is family members of varying technical ability. Favor obvious, boring, native-feeling UI over clever design. There is no growth target and no public launch — correctness, clarity, and low maintenance matter more than scale.

---

## Repository layout

Single monorepo, `bearlake/`:

```
bearlake/
  bearlake-client/    — Swift / SwiftUI iOS app (Xcode-initialized project)
  bearlake-server/    — Express + TypeScript backend
  bearlake-web/       — React admin web app
  design/             — storyboards and design references
```

`design/` is reference material, not build input. Read the storyboards there when a screen's behavior is unclear; never modify them.

Work in one app at a time. When a change spans several (e.g. adding a field to an event), update `bearlake-server/` first, then the clients. Run commands from the relevant subdirectory, not the repo root.

**The web app is a client, not a privileged path.** It uses the same `/api/v1` endpoints, the same validation, and the same authorization checks as iOS. Never add a server capability that exists only for the web app.

---

## Platform & stack

### iOS client
- **Minimum deployment: iOS 17.** Use `@Observable`, SwiftData, and `NavigationStack`. Do not generate Combine-heavy code, `ObservableObject`/`@Published`, or `NavigationView`.
- Swift 5.9+, SwiftUI only. No UIKit, no XIBs, no storyboard files.
- **Architecture: MVVM.** Views are SwiftUI structs; ViewModels are `@Observable` classes.
- **Persistence: SwiftData** — used as a local cache of server state, not as the source of truth. The API is authoritative.
- **Networking:** `URLSession` with async/await. No Alamofire or other third-party HTTP clients.
- **Styling: stock iOS.** System fonts, system colors (`Color.primary`, `.secondary`, `Color(.systemBackground)`), SF Symbols, standard `List`/`Form`/`NavigationStack` chrome. Do not introduce a custom design system, custom fonts, or hardcoded hex colors. Must look correct in both light and dark mode, and at Dynamic Type sizes up to XXL.
- **Dependencies: none by default.** Ask before adding any Swift package.

### Web admin app
- React + TypeScript, `strict: true`.
- **Admin-only.** Members have no reason to use it; the login gate rejects non-admins.
- Full CRUD for articles, categories, quick tips, announcements, and calendar events.
- Primary authoring surface for knowledge base articles — the article editor should assume a keyboard and a large screen.
- Styling should be plain and functional. This is an internal tool for two people; do not build a design system.
- **Dependencies:** ask before adding. In particular, do not add a rich-text editor library (TipTap, Lexical, Quill) — see "Article content" below.

### Backend
- Express + TypeScript, MySQL, deployed on Railway.
- Node 20+, ES modules, `strict: true` in `tsconfig.json`.
- Validate every request body and query param at the route boundary (zod or equivalent). Never trust client input.
- Use parameterized queries exclusively. Never build SQL by string concatenation.
- Config comes from environment variables only. No secrets, connection strings, or passcodes in source. `.env` is gitignored; keep `.env.example` current.
- Railway provides `PORT` and the MySQL connection variables — read them from the environment rather than hardcoding.

---

## Domain model

### Roles
Two roles only: **admin** and **member**. Two admins in practice. There is no third-party identity provider (no Sign in with Apple, no Google) and **no self-registration** — accounts are issued by an admin.

**Provisioning flow:** an admin creates a user in the web app → the server generates a random temporary password and sets `mustChangePassword = true` → the plaintext password is returned **once**, in that response only → the admin relays it out-of-band → the user is forced to change it on first login.

- There is no `POST /auth/register`. Account creation is `POST /users` and requires an authenticated admin caller. Any path that creates a user without one is a bug.
- Password reset is the same flow: admin resets, server issues a new temporary password, revokes that user's refresh tokens.
- Users are **deactivated** (`isActive = false`), never deleted, so authorship history survives.
- No email infrastructure in v1. No self-service reset, no invite links.

Admin-only capabilities (from the storyboard):
- Create, edit, delete **announcements**
- Create, edit, delete knowledge base **categories** and **articles**
- Create, edit, delete **quick tips**
- Edit or delete **any** event

Member capabilities:
- View everything
- Create events
- Edit or delete **only events they created**

**Enforce this on the server.** Hiding a button in the client is a UI affordance, not authorization. Every mutating route checks the caller's role and, for events, ownership.

### Entities

**User** — `id`, `displayName`, `email` (unique, normalized lowercase — the login identifier), `passwordHash`, `role` (`admin` | `member`), `mustChangePassword` (bool), `isActive` (bool), `lastLoginAt` (nullable), `createdAt`, `updatedAt`

**RefreshToken** — `id`, `userId` (FK), `tokenHash`, `expiresAt`, `revokedAt` (nullable), `createdAt`
Refresh tokens are persisted so they can be revoked. Store a hash, never the token.

**Event** — `id`, `title`, `notes` (nullable), `startsAt` (UTC), `endsAt` (UTC), `isAllDay` (bool), `createdBy` (user FK), `createdAt`, `updatedAt`

**Announcement** — `id`, `body`, `postedAt`, `createdBy`, `createdAt`, `updatedAt`

**QuickTip** — `id`, `body`, `sortOrder`, `createdBy`, `createdAt`, `updatedAt`

**InfoCategory** — `id`, `title`, `sortOrder`, `createdAt`, `updatedAt`

**InfoArticle** — `id`, `categoryId` (FK), `title`, `blocks` (JSON), `schemaVersion` (int), `status` (`draft` | `published`), `sortOrder`, `createdBy`, `createdAt`, `updatedAt`

Article body is a JSON array of typed blocks — see "Article content" below. Never store binary media in MySQL.

Recurring events are **out of scope** for v1. If recurrence is needed later, store an iCal RRULE string on `Event` and expand it server-side — do not invent a custom recurrence format.

### Article content — the block schema

Knowledge base articles are **structured blocks**, not rich text or HTML. This schema is a contract shared by three consumers: the React editor, the iOS editor, and the iOS renderer. Changing it means changing all three.

```typescript
type Block =
  | { id: string; type: 'heading';   text: string }
  | { id: string; type: 'paragraph'; text: string }
  | { id: string; type: 'bullets';   items: string[] }
  | { id: string; type: 'image';     key: string; caption?: string }
  | { id: string; type: 'video';     provider: 'youtube'; videoId: string; caption?: string }
```

Rules that are easy to get wrong and expensive to fix later:

- **Every block carries a stable `id`** (UUID, generated at creation). Not an array index. Reordering, editing, and React keys all depend on it.
- **Image blocks store the S3 object key, never a URL.** Images are private, so URLs are presigned and expire. The API resolves keys to presigned URLs at read time; persisted URLs would bake in an expiry and a bucket name.
- **Video is YouTube only, unlisted.** Store the video ID alone — not a full URL, not an embed snippet.
- **`schemaVersion` is stored per article.** Bump it when the block schema changes.
- **Renderers must tolerate unknown block types.** Family devices may run an old build for months after a new block type ships. In Swift, decode unrecognized `type` values into an `unknown` case and render nothing — never crash, never show an error.
- **Editors must preserve blocks they can't edit.** If the iOS editor encounters an unfamiliar block, display it read-only and round-trip it unchanged on save. Dropping it would silently destroy content written from the web app.
- Blocks have no inline formatting — no bold or links inside a paragraph. If that becomes necessary, the path is lightweight Markdown inside `paragraph.text` rendered via `AttributedString(markdown:)`, applied consistently across both renderers. Do not introduce HTML.

**Draft status.** Articles are written in batches and iterated on. `GET` endpoints return only `published` articles to members; admins receive both. Drafts must never appear in the members' iOS app.

**Concurrent edits.** Two admins are enough for conflict. `PATCH /info/articles/:id` requires the `updatedAt` the client loaded; the server responds 409 if it is stale. The client then offers to reload rather than overwriting silently.

### Media storage

**Images — S3, private bucket.** Upload flow:

```
POST /uploads/presign  →  { key, uploadUrl }   (admin only)
client PUTs bytes directly to S3 using uploadUrl
client stores the returned key in the image block
```

- Server enforces a content-type allowlist (JPEG, PNG, HEIC) and a size cap.
- Keys are namespaced: `articles/{articleId}/{uuid}`.
- Clients downscale before upload. An unmodified iPhone photo is 3–5 MB and nothing in this app needs that resolution.
- Images uploaded but never referenced by a saved block will accumulate. Orphan cleanup is a known deferred task — do not build it without asking, but do not pretend it isn't needed.

**Video — YouTube, unlisted.** No transcoding, no storage cost, no bandwidth cost, and playback works everywhere. Unlisted videos are not searchable but are viewable by anyone with the link, which is the right tradeoff for cabin instructions. Do not put video in S3.

### Dates and time — read this before touching anything date-related

This is the single largest source of bugs in a calendar app. Rules:

- The property is in Utah (America/Denver). Store **all** timestamps in UTC in MySQL (`DATETIME` in UTC, or `TIMESTAMP`), transmit as ISO-8601 with offset, and convert to the user's local time only at the view layer.
- **All-day events are a separate concept from timed events.** An all-day event is a date range, not a timestamp range. Do not represent an all-day event as midnight-to-midnight in a fixed timezone — it will shift across DST boundaries and across devices in different timezones. Store all-day events with date-only semantics and flag them with `isAllDay`.
- Never do date math with `TimeInterval` arithmetic (`+ 86400`). Use `Calendar` with explicit `DateComponents`.
- Never use `Calendar.current` inside a ViewModel without injecting it — tests need to pin the calendar and timezone.
- Day-boundary logic (which day an event "belongs to" in the month grid) belongs in one shared utility, not duplicated per view.

---

## Screens

Derived from the storyboards in `bearlake/design/`. Consult those files directly when a layout or interaction detail isn't captured below. Persistent bottom tab bar throughout: **Calendar**, **Home**, **Information**.

### Login and first-run
- **Login** — email and password. No "create account" affordance and no "forgot password" link; neither has a self-service path. Instead, text directing the user to contact a family admin. Failed login shows one generic message regardless of cause.
- **Forced password change** — presented immediately after login when `mustChangePassword` is true. Not dismissable, no tab bar shown, no way around it.
- **Voluntary password change** — from a settings entry point; requires the current password.
- The app launches into login when no valid refresh token is in the Keychain, into Home when one is.

### Home
- Announcements section: the most recent announcements, each with its date and body. Footer link to the full announcements list.
- Upcoming section: the **next three** events pulled from the calendar, each with its date range and title. Footer link to the calendar.
- Admin sees an add control for announcements; members do not.

### All Announcements
- Full reverse-chronological list of announcements.
- Back navigation to Home. Admin-only add control in the header.

### Calendar
- Month grid with a year selector and month stepper.
- **Selection rules (from the storyboard, follow exactly):**
  - Selected day defaults to the current date on first load.
  - When the **month** changes, the selected day defaults to the **first of that month**.
  - When the **year** changes, the month and selected day move to the corresponding date in the newly selected year.
- Below the grid: a **day detail** for the selected date.
  - Multi-day events and all-day events pin to the **top** of the day detail.
  - Timed events appear in an hour-by-hour scrollable column.
  - Tapping empty space in the day detail opens **Create Event** with that date pre-populated.
  - Tapping an existing event opens **Edit Event** if the viewer is the admin or the event's creator; otherwise it opens the read-only **Event Detail**.
- The `+` control (in both the month header and the day detail header) opens Create Event with the selected day pre-populated.

### Create / Edit Event
One view, two modes. Edit mode pre-populates fields.
- Fields: title, notes, all-day toggle, starts (date + time), ends (date + time).
- When **all-day** is toggled on, the time entry fields disappear; only dates remain.
- An inline date picker appears below the field currently being edited: focusing **Starts** shows the picker under Starts; focusing **Ends** moves it under Ends.
- The **X** control cancels — in create mode it discards the new event, in edit mode it reverts unsaved changes. Confirm before discarding if the user has entered data.
- The **checkmark** saves.
- **Delete Event** appears in edit mode only, never in create mode. Confirm before deleting.

### Event Detail (read-only)
- Title, formatted date/time range, notes.
- Edit control appears only for the event's creator (and for admin).

### Information
- **Quick tips** section: short free-text reference items (gate codes, where keys live). Admin can add unlimited tips.
- **Knowledge base** section: a list of categories that navigate to the category view. Admin can add unlimited categories.

### Information Category
- List of article titles within the category, each navigating to the article view.
- Admin-only add control.

### Information Article
- Renders the block array in order: headings, paragraphs, bullet lists, images, and embedded YouTube videos.
- Unknown block types render as nothing (see "Article content").
- Admin-only edit control.

### Article Editor (iOS, admin only)
Secondary authoring surface — the web app is primary. Optimized for iterating on an existing article, not writing one from scratch.
- A reorderable `List` of blocks with `.onMove` and `.onDelete`.
- A `+` menu appends a block: Heading, Paragraph, Bullet list, Photo, Video.
- Tapping a block opens a focused editor for that block alone.
- Photo blocks use the system photo picker, downscale, then upload via presign.
- Video blocks take a YouTube URL or ID and store the ID.
- Blocks of unrecognized type render read-only and are preserved on save.
- Draft/published toggle. Saving surfaces 409 conflicts as an offer to reload.

---

## API conventions

Base path `/api/v1`. JSON in, JSON out. Auth via `Authorization: Bearer <token>`.

```
POST   /auth/login                         # email + password
POST   /auth/refresh                       # rotates the refresh token
POST   /auth/logout                        # revokes the presented refresh token
POST   /auth/change-password               # self; allowed while mustChangePassword
GET    /me

GET    /users                              # admin
POST   /users                              # admin — returns temp password ONCE
PATCH  /users/:id                          # admin — displayName, role, isActive
POST   /users/:id/reset-password           # admin — returns temp password ONCE

GET    /events?start=<iso>&end=<iso>     # range query — required, not optional
POST   /events
GET    /events/:id
PATCH  /events/:id
DELETE /events/:id

GET    /announcements?limit=&cursor=
POST   /announcements                     # admin
PATCH  /announcements/:id                 # admin
DELETE /announcements/:id                 # admin

GET    /quick-tips
POST   /quick-tips                        # admin
PATCH  /quick-tips/:id                    # admin
DELETE /quick-tips/:id                    # admin

GET    /info/categories
GET    /info/categories/:id/articles       # members: published only; admins: all
GET    /info/articles/:id
POST   /info/categories                    # admin
PATCH  /info/categories/:id                # admin
DELETE /info/categories/:id                # admin
POST   /info/articles                      # admin
PATCH  /info/articles/:id                  # admin, requires updatedAt
DELETE /info/articles/:id                  # admin

POST   /uploads/presign                    # admin
```

Rules:
- `GET /events` **requires** `start` and `end`. Never expose an unbounded events query — the client fetches a visible window (the displayed month plus a buffer), not the whole table.
- Error responses share one shape: `{ error: { code: string, message: string } }`. `message` is safe to show to a user; never leak SQL errors or stack traces to the client.
- Use correct status codes: 400 validation, 401 unauthenticated, 403 unauthorized (wrong role or not the creator), 404 missing, 409 conflict (stale `updatedAt` on article PATCH).
- Article responses resolve image block `key`s into presigned URLs on the way out. The stored block keeps the key; the response carries a short-lived URL alongside it.
- Draft filtering happens on the server, keyed off the caller's role — never as a client-side filter.
- `POST /users` and `POST /users/:id/reset-password` return a plaintext temporary password **exactly once**. These are the only responses in the system carrying a plaintext credential — exclude them, plus `/auth/login` and `/auth/change-password`, from request/response logging.
- Users are deactivated via `PATCH /users/:id`, never deleted. Hard deletes remain fine for events, announcements, quick tips, and articles.
- Soft-delete is unnecessary here; hard deletes are fine, but always confirm destructively in the UI first.

---

## Auth

- Family-issued credentials only. Passwords hashed with bcrypt or argon2 — never plaintext, never a fast hash like SHA-256.
- **Email is the login identifier.** Normalize to lowercase and compare case-insensitively; two accounts differing only in case must not be creatable.
- Short-lived access token (15–60 min, memory only) plus a **long-lived rotating refresh token** (60–90 days). Family members use this a few times a season — aggressive expiry is the wrong tradeoff here.
- Refresh tokens rotate on use: each refresh issues a new token and revokes the old. Reuse of a revoked token means theft — revoke every token for that user.
- Revoke refresh tokens on password change, admin reset, and deactivation.
- **`mustChangePassword` gates the entire app.** A user in that state can call `POST /auth/change-password` and `GET /me` and nothing else; every other authenticated route returns 403 with `code: "PASSWORD_CHANGE_REQUIRED"`. Both clients implement this gate.
- Password rules: minimum 12 characters, no composition requirements, rejected against a common-password list, no rotation policy. New password must differ from current.
- **Store the refresh token in the iOS Keychain, never in `UserDefaults`.** Web uses `sessionStorage`, never `localStorage`. Access tokens live in memory on both.
- Rate-limit login per email and per IP. Respond identically for unknown email and wrong password — never reveal which accounts exist.
- Never log tokens, password hashes, or the passcodes that live in announcements and quick tips (marina codes, speaker passcodes, key locations). This app's content is genuinely sensitive to the family — treat announcement and quick-tip bodies as private data in logs and error reports.

---

## iOS conventions

- Views are pure SwiftUI structs. No networking, no business logic, no date math in a view `body`.
- ViewModels are `@Observable` classes and must **not** import SwiftUI.
- Networking lives in a `Services/` layer behind protocols so ViewModels can be tested with mocks.
- Use `Result<T, Error>` or `async throws` for API calls. **Never force-unwrap** (`!`) and never `try!`.
- Load data in `.task { }`, not `.onAppear`.
- Present errors via `.alert` bound to a ViewModel error property. Every network failure must surface something actionable to the user — never fail silently.
- Every new View gets a `#Preview` with realistic sample data.
- Use `actor` for shared mutable state (token store, image/media cache).

### SwiftData usage
SwiftData caches server responses for offline viewing. The server is the source of truth.
- `@Model` types mirror API responses; keep server `id` as the identity.
- Writes go to the API first; update the local store from the response.
- Do not attempt bidirectional sync or offline write queuing in v1. If the network is unavailable, show cached content read-only and tell the user.

### Suggested structure
```
bearlake-client/BearLake/
  App/            — @main App struct, root tab view
  Features/
    Home/         — HomeView, HomeViewModel
    Calendar/     — CalendarMonthView, DayDetailView, EventEditorView, EventDetailView + ViewModels
    Information/  — InformationView, CategoryView, ArticleView,
                    ArticleEditorView, block views + ViewModels
    Auth/         — LoginView, ChangePasswordView, AuthViewModel
  Models/         — SwiftData @Model types, API DTOs
  Services/       — APIClient, AuthService, KeychainStore
  Utilities/      — date helpers, formatters
  Tests/
```

---

## Backend conventions

```
bearlake-server/src/
  index.ts        — server bootstrap
  routes/         — one file per resource
  controllers/    — request handling
  services/       — business logic
  db/             — connection pool, queries, migrations
  middleware/     — auth, role checks, error handler
  schemas/        — request validation schemas
  types/
```

- Route handlers stay thin: validate → delegate to a service → shape the response.
- One centralized error-handling middleware. Handlers throw typed errors; the middleware maps them to status codes.
- Schema changes go through checked-in, ordered migration files. Never mutate the schema by hand against the deployed database.
- Return camelCase JSON regardless of column naming; keep the mapping in one place.

---

## Web app conventions

```
bearlake-web/src/
  pages/          — route-level screens
  components/     — shared UI
  features/
    articles/     — block editor and block-type components
    calendar/
    announcements/
    quickTips/
  api/            — typed client for /api/v1
  types/          — shared with the server where practical
```

- **The block editor is hand-rolled**, not a rich-text library. The block set is small and fixed, and anything a general-purpose editor can produce that iOS cannot render is a bug. One React component per block type, plus a reorderable list shell.
- Block type definitions live in one file and are the reference the Swift models mirror. When they change, the Swift side changes in the same task.
- The API client is typed and thin. No business logic in components; no direct `fetch` calls scattered through the tree.
- Tokens live in memory or `sessionStorage`, not `localStorage`.
- **The web app is the only surface for user management** — creating accounts, changing roles, deactivating, resetting passwords. iOS has none of this.
- When a temporary password comes back from `POST /users` or a reset, display it prominently with a copy button and a warning that it cannot be retrieved again. Don't hold it in state longer than needed; never put it in a URL.
- Reuse the server's zod schemas for form validation where practical rather than writing a parallel set of rules.
- Non-admins hitting the app get a clear rejection, not a broken UI.

---

## Commands

```bash
# iOS — from bearlake/bearlake-client/
xcodebuild build -scheme BearLake \
  -destination 'platform=iOS Simulator,name=iPhone 16' -quiet
xcodebuild test -scheme BearLake \
  -destination 'platform=iOS Simulator,name=iPhone 16' -quiet 2>&1 | tail -30
xcrun simctl list devices available

# API — from bearlake/bearlake-server/
npm run dev
npm run build
npm test
npm run lint
npm run migrate

# Web — from bearlake/bearlake-web/
npm run dev
npm run build
npm test
npm run lint
```

There is no root-level package manifest and no workspace tooling — the three apps are independent. Don't add root-level `package.json` scripts or a monorepo tool (Turborepo, Nx, npm workspaces) without asking.

---

## Working agreements

- **New Swift files do not auto-add to the Xcode target.** The project in `bearlake-client/` was initialized by Xcode, so `project.pbxproj` is authoritative and hand-managed. After creating a Swift file, say so explicitly so it can be added in Xcode. Do not edit `project.pbxproj` directly.
- Ask before adding any dependency, in any of the three apps.
- Ask before changing the database schema, the API contract, the block schema, or the auth model.
- **Changing the block schema is a three-app task.** Server validation, React editor, iOS editor, iOS renderer, and `schemaVersion` all move together. Do not ship a partial change.
- Do not invent screens, fields, or flows that aren't in this document or the storyboards. If something is genuinely ambiguous, ask rather than guessing.
- Prefer editing existing files over creating new ones. Don't create README or docs files unless asked.
- When a task touches more than one app, state the plan before writing code.
- Match the existing code style in whichever app you're editing.

## Testing priorities

Full coverage isn't the goal; these areas are where bugs will actually bite:
1. Date/timezone handling — all-day events, multi-day spans, month boundaries, DST transitions
2. Authorization — that a member genuinely cannot edit another member's event or any admin-only resource, and cannot retrieve drafts, tested at the API level
3. The event range query returning correct results for events that start before or end after the requested window
4. Calendar selection rules (month change → first of month; year change → corresponding date)
5. Block round-tripping — an article written in the web editor, opened and saved in the iOS editor, must be byte-identical if untouched, including any block type the iOS editor doesn't recognize
6. Renderer tolerance — an article containing an unknown block type renders without crashing
7. Authentication — that no endpoint creates a user without an admin caller; that `mustChangePassword` blocks every other route; that a deactivated user's existing refresh token stops working; that refresh rotation revokes the prior token and reusing a revoked one revokes the whole family
8. Credential leakage — temporary passwords appear in exactly one response and in no log output
