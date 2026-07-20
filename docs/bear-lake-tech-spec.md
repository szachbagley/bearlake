# Bear Lake Cabin App — Technical Specification

**Version:** 1.0
**Date:** July 19, 2026
**Status:** Draft for development

---

## 1. Overview

### 1.1 Purpose

A private application for an extended family to coordinate use of a shared vacation property at Bear Lake, Utah. The app replaces ad-hoc coordination (group texts, phone calls, a shared paper binder at the cabin) with a single source of truth for three things:

1. **Who is at the cabin, and when** — a shared calendar
2. **What the family needs to know right now** — an announcements feed
3. **How to operate the property** — a knowledge base of instructions and reference information

### 1.2 Audience and scale

Users are family members of varying technical ability, ranging from comfortable to reluctant. The user base is on the order of dozens, not thousands. There is no growth target, no public launch, and no monetization.

This shapes every engineering tradeoff in this document: **correctness, clarity, and low maintenance matter more than scale, performance, or extensibility.** Boring solutions are preferred. A feature that works obviously and never needs attention beats a clever one that requires occasional care.

### 1.3 Non-goals

Explicitly out of scope for v1:

- Public access or user self-registration
- Third-party identity providers (Sign in with Apple, Google, etc.)
- Recurring events
- Offline write support or bidirectional sync
- Push notifications
- Android or web clients for members (the web app is admin-only)
- Payment, expense splitting, or chore assignment
- Real-time collaborative editing

### 1.4 System components

Three applications in a single monorepo:

| Component | Directory | Stack | Audience |
|---|---|---|---|
| iOS client | `bearlake-client/` | Swift 5.9+, SwiftUI, SwiftData | All family members |
| Backend API | `bearlake-server/` | Express, TypeScript, MySQL | — |
| Web admin | `bearlake-web/` | React, TypeScript | Admins only (2 people) |

Plus `design/`, holding storyboards and design references. It is reference material, not build input.

---

## 2. Architecture

### 2.1 Topology

```
┌─────────────────┐         ┌─────────────────┐
│  iOS client     │         │  Web admin      │
│  (all members)  │         │  (2 admins)     │
└────────┬────────┘         └────────┬────────┘
         │                           │
         │      HTTPS / JSON         │
         │   Bearer token auth       │
         └─────────────┬─────────────┘
                       │
              ┌────────▼────────┐
              │  Express API    │
              │  (Railway)      │
              └────────┬────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
    ┌────▼────┐   ┌────▼────┐   ┌───▼────────┐
    │  MySQL  │   │   S3    │   │  YouTube   │
    │(Railway)│   │(images) │   │  (video,   │
    └─────────┘   └─────────┘   │  unlisted) │
                                └────────────┘
```

### 2.2 Governing principles

**The API is authoritative.** Both clients treat server state as truth. SwiftData on iOS is a read cache, not a source of truth, and never a write queue.

**The web app is a client, not a privileged path.** It uses the same `/api/v1` endpoints, the same validation schemas, and the same authorization checks as the iOS app. No server capability exists solely for the web app. This is the single most important architectural rule in the project — violating it creates two divergent sets of business rules that will drift.

**Authorization is enforced server-side, always.** Hiding a button in a client is a UI affordance, not security. Every mutating route independently verifies the caller's role and, where relevant, resource ownership.

**One app at a time.** When a change spans components, the server changes first, then clients. Partial changes are not shipped.

### 2.3 Deployment

- **API and MySQL:** Railway. `PORT` and database connection variables come from the Railway environment.
- **Web admin:** static build, deployed alongside or adjacent to the API. Admin-only, so hosting requirements are minimal.
- **iOS client:** distributed via TestFlight or ad-hoc to family devices. Not App Store.

There is no root-level package manifest and no workspace tooling. The three apps are independently built and deployed.

---

## 3. Domain model

### 3.1 Roles

Two roles only:

| Role | Count | Capabilities |
|---|---|---|
| `admin` | 2 (project owner and father-in-law) | Everything, plus content management |
| `member` | Remaining family | View everything; create events; edit/delete own events only |

**Admin-only capabilities:**
- Create, edit, delete announcements
- Create, edit, delete knowledge base categories and articles
- Create, edit, delete quick tips
- Edit or delete **any** event, regardless of creator
- Access the web admin app

**Member capabilities:**
- View announcements, calendar, and all published knowledge base content
- Create events
- Edit or delete **only events they created**

### 3.2 Account provisioning

**There is no self-registration.** No public signup form exists in either client, and no endpoint permits creating an account without an authenticated admin caller.

Accounts are created by an admin in the web app:

```
1. Admin enters displayName, email, and role
2. Server generates a random temporary password, hashes it,
   creates the user with mustChangePassword = true
3. Server returns the plaintext temporary password ONCE,
   in the creation response only
4. Admin relays it to the family member out-of-band (text, in person)
5. On first login, the client forces a password change before
   granting access to anything else
```

Rules:

- The plaintext temporary password appears in exactly one place: the response body of `POST /users`. It is never stored in plaintext, never logged, never retrievable again. If it is lost, the admin resets the account.
- Temporary passwords are randomly generated server-side, not chosen by the admin. Human-chosen temporary passwords are reused across accounts.
- `mustChangePassword` gates the entire app. A user in that state can call `POST /auth/change-password` and nothing else — every other authenticated route returns `403` with a code the client recognizes and routes on.
- **Password reset is the same flow.** An admin resets a user; the server generates a new temporary password, sets `mustChangePassword = true`, and revokes that user's refresh tokens. There is no self-service reset in v1, because there is no email infrastructure.
- Deactivation sets `isActive = false` and revokes refresh tokens. Accounts are deactivated rather than deleted, so `createdBy` history on events stays intact.

**Deferred:** email-based invites and self-service password reset. If email is added later, this flow upgrades cleanly — the invite token replaces the temporary password and reset comes nearly free. Do not build it in v1.

### 3.3 Sessions

Family members use this app a few times a season. Aggressive token expiry would mean re-authenticating on nearly every visit, which is the wrong tradeoff for a private family app.

| Token | Lifetime | Storage |
|---|---|---|
| Access | 15–60 minutes | Memory (both clients) |
| Refresh | 60–90 days, rotating | iOS Keychain / web `sessionStorage` |

- Refresh tokens **rotate on use**: each refresh issues a new token and revokes the old one.
- Reuse of an already-revoked refresh token indicates theft. Revoke every token for that user and force re-login.
- Refresh tokens are revoked on password change, admin reset, and deactivation.
- Web sessions are deliberately shorter-lived than iOS — an admin browser is more likely to be shared or left open than a personal phone.

### 3.4 Entities

**User**

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `displayName` | string | Shown as event creator |
| `email` | string | Unique, case-insensitive; login identifier |
| `passwordHash` | string | bcrypt or argon2 |
| `role` | enum | `admin` \| `member` |
| `mustChangePassword` | boolean | True on creation and after an admin reset |
| `isActive` | boolean | False revokes access without deleting history |
| `lastLoginAt` | timestamp | Nullable; lets admins spot unused accounts |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

**RefreshToken**

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `userId` | UUID FK → User | |
| `tokenHash` | string | Store a hash, never the token itself |
| `expiresAt` | timestamp | |
| `revokedAt` | timestamp | Nullable |
| `createdAt` | timestamp | |

Refresh tokens are persisted so they can be revoked — deactivating a user or resetting a password invalidates existing sessions. A stateless refresh token cannot be revoked, which defeats the purpose of `isActive`.

**Event**

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `title` | string | Required |
| `notes` | text | Nullable |
| `startsAt` | timestamp (UTC) | See §3.6 for all-day semantics |
| `endsAt` | timestamp (UTC) | |
| `isAllDay` | boolean | |
| `createdBy` | UUID FK → User | Determines edit rights |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

**Announcement**

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `body` | text | Free text |
| `postedAt` | timestamp | Displayed date |
| `createdBy` | UUID FK → User | |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

**QuickTip**

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `body` | text | Short reference item |
| `sortOrder` | int | Admin-controlled ordering |
| `createdBy` | UUID FK → User | |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

**InfoCategory**

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `title` | string | e.g. "Pool & Hot Tub" |
| `sortOrder` | int | |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

**InfoArticle**

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `categoryId` | UUID FK → InfoCategory | |
| `title` | string | |
| `blocks` | JSON | Ordered array of typed blocks — see §4 |
| `schemaVersion` | int | Bumped when block schema changes |
| `status` | enum | `draft` \| `published` |
| `sortOrder` | int | |
| `createdBy` | UUID FK → User | |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | Used for optimistic concurrency |

No binary media is stored in MySQL. Images live in S3 (referenced by key); video lives on YouTube (referenced by video ID).

### 3.5 Relationships

```
User ──< Event          (createdBy)
User ──< Announcement   (createdBy)
User ──< QuickTip       (createdBy)
User ──< InfoArticle    (createdBy)

InfoCategory ──< InfoArticle
```

Deleting a category with articles in it needs a defined behavior — either cascade, or block with a 409. Recommend blocking; accidental cascade deletion of written content is unrecoverable.

### 3.6 Dates and time

**This is the single largest source of bugs in a calendar application. Read this section before writing any date-handling code.**

The property is in Utah (`America/Denver`). Family members may open the app from other timezones.

**Rules:**

1. **Store all timestamps in UTC** in MySQL. Transmit as ISO-8601 with offset. Convert to local time only at the view layer.

2. **All-day events are a distinct concept from timed events.** An all-day event is a *date range*, not a timestamp range. Do not represent an all-day event as midnight-to-midnight in a fixed timezone — it will shift across DST boundaries and render on the wrong day for a user in a different timezone. Store all-day events with date-only semantics, flagged by `isAllDay`.

3. **Never do date math with `TimeInterval` arithmetic** (`date + 86400`). Days are not always 86,400 seconds. Use `Calendar` with explicit `DateComponents` on iOS; use a date library with explicit timezone handling on the server and web.

4. **Never use `Calendar.current` inside a ViewModel without injecting it.** Tests must pin both calendar and timezone.

5. **Day-boundary logic lives in one shared utility per app**, not duplicated per view. "Which day does this event belong to in the month grid" is one function.

**Known hazards to test explicitly:** DST spring-forward and fall-back transitions; events spanning midnight; multi-day events crossing month boundaries; an all-day event viewed from a timezone west and east of Denver.

### 3.7 Recurring events

Out of scope for v1. If added later, store an iCal RRULE string on `Event` and expand server-side. Do not invent a custom recurrence format — the problem is deeper than it appears and RRULE already solves it.

---

## 4. Article content: the block schema

### 4.1 Rationale

Knowledge base articles need headings, paragraphs, bullet lists, images, and videos, authored by a non-technical user. Three approaches were considered:

| Approach | Verdict |
|---|---|
| Rich text / WYSIWYG editor | Rejected. Expensive to build in SwiftUI; HTML storage brings sanitization and injection concerns; hard to render identically across two clients. |
| Raw Markdown | Rejected. Requires the author to learn syntax — precisely the failure mode to avoid. |
| **Structured typed blocks** | **Selected.** Each block editor is a text field, photo picker, or URL field. Rendering is a `switch`. Storage is one JSON column. Matches the mental model of Notion, Squarespace, and every modern CMS. |

### 4.2 Schema

```typescript
type Block =
  | { id: string; type: 'heading';   text: string }
  | { id: string; type: 'paragraph'; text: string }
  | { id: string; type: 'bullets';   items: string[] }
  | { id: string; type: 'image';     key: string; caption?: string }
  | { id: string; type: 'video';     provider: 'youtube'; videoId: string; caption?: string }
```

An article's `blocks` field is an ordered `Block[]`.

### 4.3 Contract rules

This schema is shared by four consumers: the React editor, the iOS editor, the iOS renderer, and server-side validation. All four move together.

**Stable block IDs.** Every block carries a UUID generated at creation — not an array index. Reordering, editing, and React reconciliation all depend on identity that survives position changes.

**Images store the S3 object key, never a URL.** Images are private, so access URLs are presigned and expire. Persisting a URL would bake in an expiry timestamp and a bucket name, both of which will eventually be wrong. The API resolves keys to presigned URLs at read time.

**Video is YouTube only, unlisted.** Store the video ID alone — not a full URL, not an embed snippet. Rationale in §4.5.

**`schemaVersion` is stored per article.** Bump it when the block schema changes. Costs nothing now; provides a migration handle later.

**Renderers must tolerate unknown block types.** Family devices may run a build that is months old. A block type added via the web app must not crash or error an older iOS client. In Swift, decode unrecognized `type` values into an `unknown` case and render nothing.

**Editors must preserve blocks they cannot edit.** If the iOS editor encounters an unfamiliar block, it displays it read-only and round-trips it unchanged on save. Dropping it would silently destroy content authored from the web app.

**No inline formatting.** No bold, italic, or links within a paragraph. If this becomes necessary, the path is lightweight Markdown inside `paragraph.text`, rendered via `AttributedString(markdown:)` on iOS and an equivalent on web. Do not introduce HTML.

### 4.4 Draft status

Articles are written in batches and iterated on over time. `status` gates visibility:

- `GET` endpoints return only `published` articles to members
- Admins receive both drafts and published
- Filtering happens **server-side**, keyed off the caller's role — never as a client-side filter

Drafts must never appear in the members' iOS app.

### 4.5 Media storage

**Images — S3, private bucket.**

Upload flow:

```
1. Client:  POST /uploads/presign          (admin only)
2. Server:  returns { key, uploadUrl }
3. Client:  PUT bytes directly to S3 via uploadUrl
4. Client:  stores key in the image block, saves article
```

Requirements:
- Server enforces a content-type allowlist (JPEG, PNG, HEIC) and a size cap
- Keys namespaced as `articles/{articleId}/{uuid}`
- Clients downscale before upload — an unmodified iPhone photo is 3–5 MB and nothing here needs that resolution
- **Orphan cleanup is a known deferred task.** Images uploaded but never saved into a block will accumulate. Do not build cleanup without asking, but do not pretend it is unnecessary.

**Video — YouTube, unlisted.**

Rationale: free, handles transcoding and adaptive streaming, works on every device, no bandwidth cost, and will keep working without maintenance. Unlisted videos are not searchable but are viewable by link — the right tradeoff for "here's how to check the chlorine."

S3 video was rejected: it costs money, requires signed URLs for privacy, and puts transcoding and playback burden on the project. Revisit only if the family objects to YouTube.

### 4.6 Concurrent editing

Two admins are enough for conflict, especially given one writes in batches while the other edits opportunistically.

`PATCH /info/articles/:id` requires the `updatedAt` value the client loaded. The server responds `409` if it is stale. The client then offers to reload rather than silently overwriting.

This is a few lines of code and prevents the one data-loss scenario the project is actually exposed to.

---

## 5. API specification

### 5.1 Conventions

- Base path: `/api/v1`
- JSON request and response bodies
- Auth via `Authorization: Bearer <token>`
- camelCase JSON regardless of database column naming; mapping lives in one place
- Error shape: `{ error: { code: string, message: string } }` — `message` is safe to display to a user; SQL errors and stack traces never reach the client

**Status codes:**

| Code | Meaning |
|---|---|
| 400 | Validation failure |
| 401 | Unauthenticated |
| 403 | Unauthorized (wrong role, or not the resource creator) |
| 404 | Not found |
| 409 | Conflict (stale `updatedAt` on article PATCH; category delete with children) |

### 5.2 Endpoints

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

GET    /events?start=<iso>&end=<iso>       # range required
POST   /events
GET    /events/:id
PATCH  /events/:id                         # creator or admin
DELETE /events/:id                         # creator or admin

GET    /announcements?limit=&cursor=
POST   /announcements                      # admin
PATCH  /announcements/:id                  # admin
DELETE /announcements/:id                  # admin

GET    /quick-tips
POST   /quick-tips                         # admin
PATCH  /quick-tips/:id                     # admin
DELETE /quick-tips/:id                     # admin

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

### 5.3 Endpoint rules

**`GET /events` requires `start` and `end`.** There is no unbounded events query. Clients fetch a visible window — the displayed month plus a buffer — not the whole table. The range query must correctly return events that *start before* or *end after* the requested window but overlap it; this is the classic off-by-one in calendar APIs.

**Article responses resolve image keys to presigned URLs on the way out.** The stored block retains the key; the response carries a short-lived URL alongside it.

**Draft filtering is server-side**, keyed off the caller's role.

**Hard deletes are acceptable** for events, announcements, quick tips, and articles — soft-delete adds complexity this project does not need. But destructive actions are always confirmed in the UI first. **Users are the exception:** deactivate via `PATCH /users/:id`, never delete, so authorship history survives.

**There is no `POST /auth/register`.** Account creation is `POST /users` and requires an authenticated admin. Any endpoint that creates a user without an admin caller is a bug.

**`POST /users` and `POST /users/:id/reset-password` return the temporary password in plaintext exactly once.** These are the only responses in the system containing a plaintext credential. They must be excluded from request logging.

**A user with `mustChangePassword = true` is restricted to `POST /auth/change-password` and `GET /me`.** Every other authenticated route returns `403` with `code: "PASSWORD_CHANGE_REQUIRED"`, which clients detect and route on.

**Login throttling:** rate-limit failed attempts per email and per IP. Respond identically for unknown email and wrong password — never reveal which accounts exist.

---

## 6. Authentication and security

### 6.1 Model

- Family-issued credentials only. No third-party identity providers, no self-registration.
- **Email is the login identifier.** Compare case-insensitively; store normalized (lowercased, trimmed). Two accounts differing only in case must not be creatable.
- Passwords hashed with **bcrypt or argon2** — never plaintext, never a fast hash like SHA-256.
- Short-lived access token plus a long-lived, rotating, revocable refresh token (§3.3).

### 6.2 Password rules

- Minimum length 12, no composition requirements (no forced symbols or mixed case). Length beats character-class rules, and this user base spans a wide range of technical comfort — a rule that produces `Password1!` on a sticky note is a net loss.
- Check against a list of common passwords; reject matches.
- No rotation policy. Forced periodic changes degrade password quality.
- The new password on `POST /auth/change-password` must differ from the current one.
- Changing a password revokes all of that user's refresh tokens, including on other devices.

### 6.3 First-login flow

```
login → 200 with tokens, and user.mustChangePassword = true
      → client routes immediately to Change Password
      → any other API call returns 403 PASSWORD_CHANGE_REQUIRED
      → change succeeds → mustChangePassword = false
                        → prior refresh tokens revoked, new pair issued
                        → normal app access
```

Both clients must implement this gate. It is not optional on either surface — an admin created from the web app hits the same flow.

### 6.4 Token storage

| Client | Access token | Refresh token |
|---|---|---|
| iOS | Memory (in an `actor`) | **Keychain.** Never `UserDefaults`. |
| Web | Memory | `sessionStorage`. Never `localStorage`. |

Never write either token to logs, crash reports, or analytics.

### 6.5 Sensitive content

This app's content is genuinely sensitive to the family. Announcements and quick tips contain marina codes, speaker passcodes, gate codes, and the location of physical keys.

**Never log** tokens, password hashes, temporary passwords, or announcement/quick-tip bodies. Treat them as private data in logs, error reports, and crash telemetry.

Request-body logging must exclude `POST /auth/login`, `POST /auth/change-password`, `POST /users`, and `POST /users/:id/reset-password` — these carry plaintext credentials in the request or the response.

### 6.6 Input handling

- Validate every request body and query parameter at the route boundary (zod or equivalent)
- Parameterized queries exclusively — never build SQL by string concatenation
- Config from environment variables only; no secrets in source
- `.env` gitignored; `.env.example` kept current
- Rate-limit authentication endpoints per email and per IP

---

## 7. iOS client

### 7.1 Stack

- **Minimum deployment: iOS 17.** Use `@Observable`, SwiftData, `NavigationStack`. Do not use `ObservableObject`/`@Published`, `NavigationView`, or Combine-heavy patterns.
- Swift 5.9+, SwiftUI only. No UIKit, no XIBs, no storyboard files.
- **Architecture: MVVM.** Views are SwiftUI structs; ViewModels are `@Observable` classes.
- **Networking:** `URLSession` with async/await. No third-party HTTP clients.
- **Dependencies: none by default.** Adding a Swift package requires discussion.

### 7.2 Styling

Stock iOS throughout. System fonts, system colors (`Color.primary`, `.secondary`, `Color(.systemBackground)`), SF Symbols, standard `List`/`Form`/`NavigationStack` chrome.

No custom design system, no custom fonts, no hardcoded hex colors. Must render correctly in light and dark mode and at Dynamic Type sizes through XXL.

### 7.3 Conventions

- Views are pure. No networking, business logic, or date math in a view `body`.
- ViewModels do **not** import SwiftUI.
- Networking lives behind protocols in `Services/` so ViewModels are testable with mocks.
- `async throws` or `Result<T, Error>` for API calls. **Never force-unwrap** (`!`), never `try!`.
- Load data in `.task { }`, not `.onAppear`.
- Errors surface via `.alert` bound to a ViewModel error property. Network failures always produce something actionable — never a silent failure.
- Every View gets a `#Preview` with realistic sample data.
- `actor` for shared mutable state (token store, media cache).

### 7.4 SwiftData usage

SwiftData caches server responses for offline **viewing**. The server is the source of truth.

- `@Model` types mirror API responses; server `id` is the identity
- Writes go to the API first; the local store updates from the response
- **No bidirectional sync, no offline write queue in v1.** If the network is unavailable, show cached content read-only and say so

### 7.5 Structure

```
bearlake-client/BearLake/
  App/            — @main App struct, root tab view
  Features/
    Home/         — HomeView, HomeViewModel
    Calendar/     — CalendarMonthView, DayDetailView,
                    EventEditorView, EventDetailView + ViewModels
    Information/  — InformationView, CategoryView, ArticleView,
                    ArticleEditorView, block views + ViewModels
    Auth/         — LoginView, AuthViewModel
  Models/         — SwiftData @Model types, API DTOs
  Services/       — APIClient, AuthService, KeychainStore
  Utilities/      — date helpers, formatters
  Tests/
```

### 7.6 Xcode project management

The project was initialized by Xcode, so `project.pbxproj` is authoritative and hand-managed. New Swift files do not auto-add to the target — they must be added in Xcode. Do not edit `project.pbxproj` directly.

---

## 8. Screens (iOS)

Derived from the storyboards in `design/`. Consult those directly for layout detail not captured here.

Persistent bottom tab bar throughout: **Calendar**, **Home**, **Information**.

### 8.0 Login and first-run

**Login** — email and password fields, sign-in button. No "create account" affordance and no "forgot password" link; there is no self-service path for either. Instead, a line of text directing the user to contact a family admin. Failed login shows one generic message regardless of cause.

**Change Password (forced)** — presented immediately after login when `mustChangePassword` is true. Cannot be dismissed or backed out of; the tab bar is not shown. Fields: new password, confirm. On success, proceeds into the app.

**Change Password (voluntary)** — reachable from a settings entry point. Requires the current password.

The app launches into login when no valid refresh token is present in the Keychain, and into Home when one is.

### 8.1 Home

- **Announcements section** — most recent announcements, each with date and body. Footer link to the full list.
- **Upcoming section** — the **next three** events from the calendar, each with date range and title. Footer link to the calendar.
- Admin sees an add control for announcements; members do not.

### 8.2 All Announcements

- Full reverse-chronological list
- Back navigation to Home
- Admin-only add control in the header

### 8.3 Calendar

Month grid with a year selector and month stepper.

**Selection rules — follow exactly:**
- Selected day defaults to the current date on first load
- When the **month** changes, selected day defaults to the **first of that month**
- When the **year** changes, month and selected day move to the corresponding date in the new year

Below the grid, a **day detail** for the selected date:
- Multi-day and all-day events pin to the **top**
- Timed events appear in an hour-by-hour scrollable column
- Tapping empty space opens **Create Event** with that date pre-populated
- Tapping an event opens **Edit Event** if the viewer is admin or the event's creator; otherwise read-only **Event Detail**

The `+` control (month header and day detail header) opens Create Event with the selected day pre-populated.

### 8.4 Create / Edit Event

One view, two modes. Edit mode pre-populates.

- Fields: title, notes, all-day toggle, starts (date + time), ends (date + time)
- When **all-day** is on, time entry fields disappear; only dates remain
- An inline date picker appears below the field being edited — focusing **Starts** places it under Starts, focusing **Ends** moves it under Ends
- **X** cancels: discards a new event in create mode, reverts unsaved changes in edit mode. Confirm if data has been entered.
- **Checkmark** saves
- **Delete Event** appears in edit mode only, never create. Confirm before deleting.

### 8.5 Event Detail (read-only)

Title, formatted date/time range, notes. Edit control appears only for the creator or an admin.

### 8.6 Information

- **Quick tips** — short reference items (gate codes, key locations). Admin-only add control.
- **Knowledge base** — list of categories navigating to the category view. Admin-only add control.

### 8.7 Information Category

List of article titles, each navigating to the article. Admin-only add control.

### 8.8 Information Article

Renders the block array in order: headings, paragraphs, bullet lists, images, embedded YouTube videos. Unknown block types render as nothing. Admin-only edit control.

### 8.9 Article Editor (iOS, admin only)

Secondary authoring surface — the web app is primary. Optimized for iterating on an existing article rather than writing from scratch.

- Reorderable `List` of blocks with `.onMove` and `.onDelete`
- `+` menu appends: Heading, Paragraph, Bullet list, Photo, Video
- Tapping a block opens a focused editor for that block alone
- Photo blocks use the system photo picker, downscale, then upload via presign
- Video blocks accept a YouTube URL or ID and store the ID
- Unrecognized blocks render read-only and are preserved on save
- Draft/published toggle
- Save surfaces `409` conflicts as an offer to reload

---

## 9. Backend

### 9.1 Stack

Express + TypeScript, MySQL, Railway. Node 20+, ES modules, `strict: true`.

### 9.2 Structure

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

### 9.3 Conventions

- Route handlers stay thin: validate → delegate to a service → shape the response
- One centralized error-handling middleware; handlers throw typed errors, middleware maps to status codes
- Schema changes go through checked-in, ordered migration files. Never mutate the deployed schema by hand.
- camelCase JSON out, mapping in one place

---

## 10. Web admin app

### 10.1 Stack and scope

React + TypeScript, `strict: true`. **Admin-only** — the login gate rejects non-admins with a clear message, not a broken UI.

Full CRUD for articles, categories, quick tips, announcements, and calendar events. This is the **primary authoring surface** for knowledge base articles; the editor should assume a keyboard and a large screen.

It is also the **only** surface for user management — creating accounts, changing roles, deactivating users, and resetting passwords. The iOS app has no user administration.

**Temporary password handling.** When an admin creates a user or resets a password, the response contains a plaintext temporary password shown exactly once. The UI must make this unmissable: display it prominently, provide a copy button, and warn that it cannot be retrieved again. Do not persist it in component state longer than needed, and never place it in a URL.

Styling is plain and functional. This is an internal tool for two people — do not build a design system.

### 10.2 Structure

```
bearlake-web/src/
  pages/          — route-level screens
  components/     — shared UI
  features/
    articles/     — block editor and block-type components
    calendar/
    announcements/
    quickTips/
    users/        — account creation, roles, deactivation, resets
  auth/           — login, forced password change, token handling
  api/            — typed client for /api/v1
  types/          — shared with the server where practical
```

### 10.3 The block editor

**Hand-rolled, not a rich-text library.** Do not add TipTap, Lexical, Quill, or similar.

Rationale: the block set is small and fixed. A general-purpose editor would need to be constrained back down to match what iOS can render, and anything it can produce that iOS cannot display is a bug. One React component per block type plus a reorderable list shell is roughly a day of work and guarantees parity.

Block type definitions live in **one file** and are the reference the Swift models mirror. When they change, the Swift side changes in the same task.

### 10.4 Conventions

- Typed, thin API client. No business logic in components; no scattered `fetch` calls.
- Reuse the server's validation schemas for form validation where practical rather than maintaining a parallel rule set.
- Tokens in memory or `sessionStorage`, never `localStorage`.

---

## 11. Testing

Full coverage is not the goal. These are the areas where bugs will actually occur:

1. **Date and timezone handling** — all-day events, multi-day spans, month boundaries, DST transitions, viewing from a non-Denver timezone
2. **Authorization** — that a member cannot edit another member's event, cannot reach any admin-only resource, and cannot retrieve drafts. Tested at the API level, not through the UI.
3. **Event range queries** — correct results for events starting before or ending after the requested window
4. **Calendar selection rules** — month change → first of month; year change → corresponding date
5. **Block round-tripping** — an article written in the web editor, opened and saved in the iOS editor, is unchanged if untouched, *including block types the iOS editor does not recognize*
6. **Renderer tolerance** — an article containing an unknown block type renders without crashing
7. **Authentication** — that no endpoint creates a user without an admin caller; that `mustChangePassword` genuinely blocks every other route; that a deactivated user's existing refresh token stops working; that refresh rotation revokes the prior token and that reusing a revoked one revokes the whole family of tokens
8. **Credential leakage** — that temporary passwords appear in exactly one response and in no log output

**Note on (5):** compare parsed structures, not raw JSON strings. Key ordering may differ between Swift and TypeScript serialization, which would fail a byte-comparison for cosmetic reasons.

---

## 12. Open decisions

| # | Decision | Blocks | Notes |
|---|---|---|---|
| 1 | **Category deletion behavior** | Phase 4 | Recommend blocking with 409 rather than cascade — accidental deletion of written content is unrecoverable. |
| 2 | **Orphan image cleanup strategy** | Phase 7 | Periodic sweep of S3 keys not referenced by any article. Deferred, not ignored. |
| 3 | **Web app hosting** | Phase 5 | Served from the Express app vs. separate static host. |
| 4 | **Announcement expiry** | — | Storyboard shows announcements accumulating indefinitely. May want archiving eventually. |
| 5 | **First-admin bootstrap mechanism** | Phase 1 | Migration seed vs. CLI script. Either works; pick one and document it. |

**Resolved:**

- **Account provisioning** (§3.2) — admin creates accounts with a one-time temporary password; forced change on first login. No self-registration, no email infrastructure in v1.
- **Login identifier** — email, normalized and compared case-insensitively.
- **Session length** (§3.3) — long-lived rotating refresh tokens, stored server-side so they can be revoked.
- **Password reset** — admin-initiated only in v1; same mechanism as provisioning. Self-service reset deferred until email exists.

---

## 13. Reference

- **`CLAUDE.md`** (repo root) — operational guidance for Claude Code; a condensed form of this document
- **`design/`** — storyboards for all screens
- Nested `CLAUDE.md` files may be added under `bearlake-client/`, `bearlake-server/`, and `bearlake-web/` if per-app conventions diverge
