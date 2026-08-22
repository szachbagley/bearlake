# Bear Lake iOS Client — Development Plan

**Scope:** `bearlake-client/` only. Swift + SwiftUI, stock Apple styling, iPhone.
**Sources of truth:** `CLAUDE.md`, `docs/bear-lake-tech-spec.md` §7–§8, `design/bear-lake-storyboard.png`, and the **live API contract** in `bearlake-server/` (deployed, tagged `server-v1`).
**Reference implementation:** `bearlake-web/` (deployed, tagged `web-v1`) consumes the same API and already has every request/response shape verified against the running server. When this plan says "mirror the web app," read the named file — do not re-derive the contract.

Where the sources leave a decision open, this plan closes it (§2). Development is execution of this plan; deviations require amending §2 first.

---

## 1. Goal

The member-facing app for the family. Everyone uses it; the two admins get extra controls inline.

Screens: login, forced/voluntary password change, Home, All Announcements, Calendar (month grid + day detail), Create/Edit Event, Event Detail, Information, Information Category, Information Article, Article Editor (admin only).

**Non-goals:** user management (web-only, permanently), iPad-specific layouts, offline writes, push notifications, recurring events, biometric unlock, watchOS.

---

## 2. Decision record

Every open or unspecified choice, resolved. Final for v1. Referenced as **C1…C50** throughout.

### 2.1 Toolchain and project

| # | Decision | Choice | Rationale |
|---|---|---|---|
| C1 | Deployment target | **iOS 17.0.** The Xcode template set `IPHONEOS_DEPLOYMENT_TARGET = 26.0`; ✅ **corrected in Phase 0** — the built bundle now reports `MinimumOSVersion 17.0`. (The project-level default and the test target sit at 17.6; harmless, see the Phase 0 status note.) | `CLAUDE.md` and spec §7.1 both specify iOS 17. Shipping at 26.0 would silently exclude family members whose phones are a year or two old — the exact opposite of this app's purpose. iOS 17 still gives `@Observable`, SwiftData, `NavigationStack`, and `PhotosPicker`. |
| C2 | Swift language mode | **Swift 5 mode** (`SWIFT_VERSION = 5.0`, as set). Enforce concurrency by hand: `@MainActor` on ViewModels, `actor` for shared mutable state. | Swift 6 strict concurrency across SwiftData + `@Observable` is a large, churn-heavy migration for a family app with two admins. Revisit after v1 ships. Recorded so the choice is deliberate, not accidental. |
| C3 | Xcode | **26.0.1 (17A400)**, at `/Applications/Xcode.app`. ✅ `xcode-select` repointed in Phase 0; `xcodebuild` and `simctl` both work. | Nothing else in the plan could be verified until this was right — which is why it was step 1. |
| C4 | Simulator | **`platform=iOS Simulator,name=iPhone 17`** — recorded in Phase 0 from `xcrun simctl list devices available`, and verified by an actual build, install, and launch. **Only iOS 26.0 runtimes are installed** (no iOS 17 runtime), so the app is *built* against a 17.0 deployment target but *run* on 26.0. | The toolchain turned out to be Xcode 26.0.1 with 15 available devices. Running on 26 while targeting 17 is the normal arrangement and is safe in one direction that matters: the compiler rejects any API newer than the deployment target, so accidental iOS 18+ usage fails the build rather than crashing a family member's phone. What it does **not** catch is iOS 17 *runtime* behaviour differences. If anything date-, layout-, or SwiftData-related looks suspicious, install an iOS 17 runtime and re-check rather than assuming. |
| C5 | Adding Swift files | **Files auto-add. No Xcode GUI step, no `project.pbxproj` edits.** The target uses a `PBXFileSystemSynchronizedRootGroup` over the inner `bearlake-client/` folder (`objectVersion = 77`): any `.swift` file created anywhere beneath it is compiled into the target automatically. | **This contradicts `CLAUDE.md`'s working agreement** ("New Swift files do not auto-add to the Xcode target… `project.pbxproj` is authoritative and hand-managed"), which was written for the older project format. Evidence: the `PBXSourcesBuildPhase` `files` list is *empty* and neither existing Swift file is referenced individually, yet the app builds. **✅ PROVEN in Phase 0.** `Utilities/BuildProbe.swift` was created from the command line in a folder named nowhere in `project.pbxproj`, referenced from `PlaceholderView`, and the app built, installed, launched, and rendered the probe's string on screen; `nm` showed the `BuildProbe` symbol in the binary. Files auto-add — no GUI step, ever, for new Swift files. The probe has been deleted. The "never hand-edit `project.pbxproj`" half of that rule still stands and gets stronger — the file is now generated, not curated. |
| C6 | Test target | A unit-test target must be **created once in Xcode's GUI** (File → New → Target → Unit Testing Bundle, named `bearlake-clientTests`). Synchronized groups auto-add *files*, not *targets*. | The one unavoidable GUI step in the whole plan. Done in Phase 0 so every later phase can run `xcodebuild test` from the CLI. |
| C7 | Test framework | **Swift Testing** (`import Testing`, `@Test`, `#expect`). Native in Xcode 16+. | Cleaner than XCTest for value-oriented tests, which is nearly all of this app's logic. XCTest remains available if a specific need appears. |
| C8 | UI tests | **None** (no XCUITest bundle). Verification at each phase gate is a **scripted manual simulator run** with screenshots, mirroring how `bearlake-web` used browser checks. | XCUITest is slow and brittle, and it is a second test stack to maintain for a two-admin app. The simulator check catches what unit tests cannot — layout, navigation, Dynamic Type — without that cost. |
| C9 | Dependencies | **None.** No Swift packages. | `CLAUDE.md`. Everything needed (`URLSession`, `PhotosPicker`, SwiftData, `ImageIO`, `WKWebView`) is in the SDK. |
| C10 | Scheme / product name | Keep the existing scheme and target name **`bearlake-client`** and bundle id `hansen.bearlake-client`. | `CLAUDE.md`'s example commands said `-scheme BearLake`, which does not exist. Renaming a scheme to match a doc is backwards, so `CLAUDE.md` was corrected instead (same edit as C5). |
| C11 | Source folder | Keep the real path **`bearlake-client/bearlake-client/`**, adding subfolders inside it. | Spec §7.5 sketches `bearlake-client/BearLake/`. Renaming the folder would break the synchronized group's `path` and is pure churn. The subfolder *names* from §7.5 are adopted exactly. |

### 2.2 Configuration and networking

| # | Decision | Choice | Rationale |
|---|---|---|---|
| C12 | API base URL | One `AppConfig` enum. `#if DEBUG` → `http://localhost:3000/api/v1`; release → `https://bearlake-server-production.up.railway.app/api/v1`. No secrets — the API URL is public. | Mirrors the web app's single-source-of-truth config (W33) without a build-settings mechanism the app does not need. |
| C13 | App Transport Security | DEBUG builds talk to `localhost` over HTTP, which ATS may refuse. Mitigation, applied in Phase 0: a real `Info.plist` with `NSAppTransportSecurity → NSAllowsLocalNetworking = true`, plus **`INFOPLIST_FILE = Info.plist` with `GENERATE_INFOPLIST_FILE` left at `YES`** (the merge is verified — see Phase 0 step 6; the original "set it to NO and hand-copy the keys" instruction is superseded). **Phase 2 verifies an actual localhost request succeeds** before any feature depends on it. | `NSAllowsLocalNetworking` is Apple's sanctioned key for exactly this and does not weaken production HTTPS. Treated as a risk to *verify* rather than an assumption, because a silently blocked request looks like a bug in our code. The simulator shares the Mac's network stack, so `localhost` resolves; a physical device does not, which is why Phase 11's device check runs against the deployed API instead. |
| C14 | Networking | `URLSession` + `async throws`, behind a `BearLakeAPI` **protocol** in `Services/`. ViewModels depend on the protocol. | Spec §7.3. Protocol-backed is what makes ViewModels testable without a server. |
| C15 | Request bodies | **Exact field sets**, one `Encodable` request struct per endpoint. Never a general-purpose dictionary or a `Partial`-style type. | The server uses `z.strictObject` everywhere — an unknown key is a **400**, not a silent strip. Same rule the web app follows (W11). |
| C16 | Response envelopes | Transcribed per-endpoint from `bearlake-web/src/api/endpoints.ts`, which is verified against the running server: named wrappers for lists (`{events}`, `{categories}`, `{articles}`, `{quickTips}`, `{users}`; `{items, nextCursor}` for announcements), **bare objects** for create/get/patch, **204 with no body** for `DELETE` and `logout`. | Re-deriving these from the server source risks a mismatch the web app already paid to discover. |
| C17 | Error model | `APIError { status: Int, code: String, message: String }`. `code` stays a **`String`**, with a separate `KnownErrorCode` enum for comparisons. `message` is display-safe and shown to the user directly. | An unrecognized code (server adds one before the app is rebuilt) must still carry the server's real message, not collapse to "something went wrong". Mirrors web W13. Codes: `VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `UNAUTHENTICATED`, `FORBIDDEN`, `PASSWORD_CHANGE_REQUIRED`, `ACCOUNT_DISABLED`, `NOT_FOUND`, `STALE_ARTICLE`, `CATEGORY_NOT_EMPTY`, `EMAIL_IN_USE`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `INTERNAL`. |
| C18 | 401 handling | **Single-flight refresh**: the first 401 triggers `POST /auth/refresh`; concurrent 401s await the same in-flight task and then retry **once**. A failed refresh clears the session and routes to login. Implemented in an `actor`. | Refresh tokens rotate, and reuse of a rotated token makes the server revoke the entire token family as suspected theft (server D7/D36). Parallel refreshes would sign the user out. The web app hit exactly this bug under React StrictMode; do not repeat it. |
| C19 | CORS | **Not applicable.** Native `URLSession` sends no `Origin` header, and the API explicitly allows origin-less requests. No `WEB_ORIGIN` change is needed for iOS. | Recorded because it looks like it should matter and does not — including for the direct-to-S3 upload, where the bucket's CORS rules are likewise browser-only. |
| C20 | Token storage | Access token **in memory only**, inside an `actor TokenStore`. Refresh token in the **Keychain**, `kSecAttrAccessibleAfterFirstUnlock`, one item keyed to the bundle id. Never `UserDefaults`. | Spec §6.4. `AfterFirstUnlock` lets a backgrounded app refresh without the device being unlocked, while still protecting an at-rest device. |
| C21 | Logout | Best-effort `POST /auth/logout` to revoke server-side, then clear the Keychain and memory regardless of whether the call succeeded. | A failed network call must never leave a user apparently signed in. |

### 2.3 Dates and time — read before writing any date code

| # | Decision | Choice | Rationale |
|---|---|---|---|
| C22 | All-day events are **strings** | `startsAt`/`endsAt` for an all-day event are `YYYY-MM-DD` and are decoded, stored, compared, and formatted **as `String`**. Never converted to `Date`. Comparison is lexicographic. | `ISO8601DateFormatter` and `Date(fromISO:)` on a bare date read it as UTC midnight, which renders a day early for any negative-offset viewer — the single largest bug class in this app. The web app made the same call (W19) and it held. |
| C23 | Timed events are instants | Decoded with `ISO8601DateFormatter` configured `[.withInternetDateTime, .withFractionalSeconds]`. | The server emits `2026-01-01T00:00:00.000Z`. **Without `.withFractionalSeconds` this silently returns `nil`** — a decode failure that looks like missing data. |
| C24 | Discriminating the two | A single `EventDates` enum with `.allDay(start: String, end: String)` and `.timed(start: Date, end: Date)`, decoded off the `isAllDay` flag. The rest of the app pattern-matches; no view ever sees a raw pair. | Makes "which shape is this?" a compiler-enforced question. Mixing shapes on write is a server 400 (W15). |
| C25 | Inclusive end dates | An all-day `endsAt` is the **last day, inclusive**. A Jul 16–20 stay is `"2026-07-16"` … `"2026-07-20"` and is labelled *through Jul 20*. | Server D15/D17. Off-by-one here is the classic multi-day-stay bug. |
| C26 | Calendar injection | Every ViewModel doing date math takes a `Calendar` and `TimeZone` in its initializer. **Never `Calendar.current` inline.** | `CLAUDE.md`. Tests must pin the calendar and zone to be meaningful. |
| C27 | Day-boundary logic | One `Utilities/CabinDate.swift`. Month-grid enumeration, "which day does this event belong to", inclusive range labelling, and date-only formatting all live there and nowhere else. | `CLAUDE.md` requires a single shared utility rather than per-view duplication. |
| C28 | Timezone display | iOS renders **viewer-local** time. **No cabin-time echo** (the web app's W18 feature is deliberately not ported). | Web W18 reasons this out: the phone answers "when is my stay", so viewer-local is correct. The echo exists on web because a travelling admin *authoring* an event could otherwise enter the wrong hour. Presentation differs; stored instants do not. |
| C29 | Date arithmetic | `Calendar` with `DateComponents` only. Never `TimeInterval` arithmetic (`+ 86400`). | `CLAUDE.md`. Adding 86400 seconds is wrong across both DST transitions. |

### 2.4 Blocks and article content

| # | Decision | Choice | Rationale |
|---|---|---|---|
| C30 | Block model | Swift `enum Block` with associated values for `heading`, `paragraph`, `bullets`, `image`, `video`, plus **`unknown(UnknownBlock)`**. Mirrors `bearlake-web/src/types/blocks.ts`, which is the shared reference. | Spec §4.3. Changing the block schema is a three-app task; this file is the Swift half of the contract. |
| C31 | Unknown-block preservation | `UnknownBlock` retains its **complete raw JSON** as `[String: JSONValue]` (a small `Codable` any-JSON type) and re-encodes **byte-equivalently**. The editor shows it read-only; the renderer draws nothing. | Spec §4.3/§8.8 and web W23. The server rejects unknown types today, so this can only fire after a future schema addition — precisely when silently dropping content would be unrecoverable. |
| C32 | Round-trip testing | Compare **parsed structures**, not raw JSON strings. | Spec §11 note: Swift and TypeScript order keys differently, so a byte comparison fails for cosmetic reasons. |
| C33 | Block ids | `UUID().uuidString.lowercased()` for every new block, unique within an article. | The server validates lowercase UUIDs; ids are the identity for reorder, edit, and `List` diffing. |
| C34 | Image blocks | Render from the transient `url` the API attaches at read time. The **`key`** is what is persisted; `url` is **stripped from every block before any write**. | Server D24 / web W25. Persisting a presigned URL bakes in an expiry and a bucket name. A test asserts no write payload contains `url`. |
| C35 | Image caching | Cache decoded images keyed on the block's **`key`**, never on the `url`. An `actor ImageCache` holds them. | Presigned URLs rotate on every fetch and expire in 15 minutes, so a URL-keyed cache never hits and grows without bound. This is easy to get wrong and invisible when wrong. |
| C36 | Image loading | A small `CachedAsyncImage` view over the `ImageCache`, not bare `AsyncImage`. | Bare `AsyncImage` re-downloads on every appearance because the URL differs each time (C35). |
| C37 | Video blocks | Inline **`WKWebView`** (via `UIViewRepresentable`) pointed at `youtube-nocookie.com/embed/{id}`. Input accepts a full YouTube URL or a bare id and stores the **11-character id only**; port the four URL shapes from `bearlake-web/src/utils/youtube.ts`. | The storyboard shows an inline player in the article. **This is the one sanctioned exception to `CLAUDE.md`'s "SwiftUI only, no UIKit"**: iOS 17 has no SwiftUI-native web view (the SwiftUI `WebView` arrived in iOS 26, above our floor), and YouTube cannot be played through `AVPlayer`. Confined to a single ~30-line file so the exception stays contained. |
| C38 | Draft visibility | Members never see drafts; the server filters by role. The iOS app applies **no client-side status filter**. | Spec §4.4. Filtering client-side would imply drafts were transmitted, which they are not. Admins do see both and get a status badge. |
| C39 | Article concurrency | `PATCH /info/articles/:id` always sends the `updatedAt` the editor loaded. A **409 `STALE_ARTICLE`** shows a non-dismissable choice: **Reload** (discard local edits) or **Copy my changes** (blocks JSON to the pasteboard, then reload). Never auto-overwrite. | Server D23 / web W16. Silent overwrite is the one real data-loss path in this project. |

### 2.5 Images, upload, and media

| # | Decision | Choice | Rationale |
|---|---|---|---|
| C40 | Photo picking | SwiftUI **`PhotosPicker`**. No custom picker, no camera in v1. | Native, no permission prompt needed for the modern picker, and it matches spec §8.9. |
| C41 | Downscale | `ImageIO` (`CGImageSourceCreateThumbnailAtIndex`) to max **2000 px** on the long edge, re-encoded **JPEG q0.85**. **Always re-encode, including HEIC.** | Spec §4.5. This *diverges from the web app deliberately*: the web must upload HEIC untouched because `<canvas>` cannot decode it, but iOS decodes HEIC natively, so the client that most often *produces* HEIC is also the one that can normalise it. `ImageIO` thumbnailing avoids decoding a 12 MP image into memory. |
| C42 | Upload pipeline | Validate type/size → downscale → `POST /uploads/presign` with the **post-downscale** byte count → `PUT` the exact bytes to S3 with the exact `Content-Type` → store the returned **key**. | The presigned PUT signs `Content-Type` **and** `Content-Length` (server D25); a mismatch is rejected by S3, not by us. Allowlist `image/jpeg`, `image/png`, `image/heic`; cap 10 MB — from `bearlake-web/src/types/limits.ts`. |
| C43 | Upload progress | `URLSession` upload task with a delegate feeding a progress value the editor displays. | A silent multi-second upload on cellular reads as a frozen app. |
| C44 | Orphan images | Unreferenced S3 objects accumulate; **cleanup remains deferred** (spec §12 open decision 2). Do not build it. Test uploads made during development are deleted with `aws s3api delete-object`. | Consistent with the server and web plans. Acknowledged, not silently ignored. |

### 2.6 Caching, UI, and access

| # | Decision | Choice | Rationale |
|---|---|---|---|
| C45 | SwiftData scope | Caches **read models only** for offline *viewing*: announcements, events, quick tips, categories, article summaries, full articles. Blocks are stored as a JSON `Data` blob and decoded on read. **No offline writes, no bidirectional sync.** Server is the source of truth; writes go to the API first and the cache updates from the response. | Spec §7.4. An offline write queue is a distributed-systems problem this app does not have. |
| C46 | Offline UX | When a fetch fails and cached content exists, show the cache **read-only** with a banner saying so, and disable mutating controls. With no cache, show an actionable error. | Spec §7.4 — "show cached content read-only and say so." Never fail silently (spec §7.3). |
| C47 | Navigation & chrome | Bottom `TabView`: **Calendar, Home, Information**, opening on **Home**. `NavigationStack` per tab. A **☰ menu** in the top-right of each tab root opens a settings sheet with *Change password* and *Sign out*. | Straight from the storyboard, which shows the tab bar throughout and ☰ on every root screen. The settings sheet is where spec §8.0's "voluntary change password" entry point lives. |
| C48 | Admin affordances | Admin-only `+`/edit controls are **hidden** for members. This is a **UI affordance, not the security boundary** — the server independently rejects every admin route. Stated in code comments so no one mistakes it for the control. | Spec §3.1. Same framing the web app uses (W29). |
| C49 | User management | **Not on iOS, ever.** No user list, no create, no reset. | `CLAUDE.md`: the web app is the only surface for user management. |
| C50 | Accessibility | Dynamic Type through **XXL**, VoiceOver labels on every control, light and dark mode. Verified in the simulator at each gate, not just at the end. | `CLAUDE.md` §iOS styling. Retrofitting accessibility is far more expensive than maintaining it. |

---

## 3. Project structure (target)

```
bearlake-client/
  client-dev-plan.md
  bearlake-client.xcodeproj/
  Info.plist                        — ATS local-networking exception (C13)
  bearlake-client/                  — synchronized group; everything here compiles (C5)
    App/
      BearLakeApp.swift             — @main, root switch: login vs. tab shell
      RootTabView.swift             — Calendar | Home | Information
      SettingsSheet.swift           — ☰ menu: change password, sign out
    Features/
      Auth/                         — LoginView, ChangePasswordView + ViewModels
      Home/                         — HomeView, AllAnnouncementsView,
                                      AnnouncementEditorView + ViewModels
      Calendar/                     — CalendarMonthView, MonthGrid, DayDetailView,
                                      EventEditorView, EventDetailView + ViewModels
      Information/                  — InformationView, CategoryView, ArticleView,
                                      ArticleEditorView,
                                      Blocks/{Heading,Paragraph,Bullets,Image,Video,Unknown}
                                      + ViewModels
    Models/
      DTOs/                         — Codable API types, one file per resource
      Block.swift                   — block enum + JSONValue (C30/C31)
      Cache/                        — SwiftData @Model types (Phase 10)
    Services/
      BearLakeAPI.swift             — protocol
      APIClient.swift               — URLSession implementation
      APIError.swift
      TokenStore.swift              — actor; memory + Keychain
      KeychainStore.swift
      ImageCache.swift              — actor, keyed by S3 key (C35)
      ImageUpload.swift             — downscale + presign + PUT
    Utilities/
      CabinDate.swift               — all date logic (C27)
      YouTube.swift                 — id extraction (C37)
      AppConfig.swift               — base URL (C12)
  bearlake-clientTests/             — Swift Testing target (C6)
```

---

## 4. Phase gate

A phase is complete only when all of the following pass, in order:

1. **Build** — `xcodebuild build -scheme bearlake-client -destination "$SIM" -quiet`, zero warnings introduced.
2. **Tests** — `xcodebuild test -scheme bearlake-client -destination "$SIM" -quiet`, all green including every prior phase's.
3. **Simulator run** — launch the app, exercise the phase's screens by hand, capture a screenshot of each new screen.
4. **Accessibility spot-check** — the phase's new screens at Dynamic Type XXL and in dark mode (C50).
5. **Self-review** against the §6 checklist for every file touched.
6. **Commit** naming the phase; **open a PR** to `master`, per the repo's one-branch-per-phase workflow.

`$SIM` is the destination string recorded in Phase 0. Do not start phase N+1 with phase N's gate unmet.

---

## 5. Phases

### Phase 0 — Toolchain, project configuration, and a running app

Nothing here is app code; it is making the build verifiable. Several steps need `sudo` or the Xcode GUI and must be run by the user.

**Steps:**

1. **Point the toolchain at Xcode.** ✅ Done by the user. `xcodebuild -version` → **Xcode 26.0.1 (17A400)**.
2. **Ensure an iOS simulator runtime exists.** ✅ Two **iOS 26.0** runtimes were already installed; no download needed. **No iOS 17 runtime** — see C4 for what that does and does not cover.
3. **Record the destination.** ✅ **`platform=iOS Simulator,name=iPhone 17`**, recorded in C4 and in `CLAUDE.md`'s command block.
4. **Set the deployment target to 17.0** (C1) in Xcode → target → General, or by editing the target's build settings in the GUI. Confirm `IPHONEOS_DEPLOYMENT_TARGET = 17.0`.
5. **Create the test target** (C6): File → New → Target → Unit Testing Bundle, product name `bearlake-clientTests`, and confirm it is added to the scheme's Test action. The folder and its first test file already exist — **delete the template test file Xcode generates** so the bundle does not carry two.

    **Also mark the scheme "Shared"** while in the GUI (Product → Scheme → Manage Schemes → tick *Shared*). *Found during Phase 0:* the `bearlake-client` scheme lives only in `xcuserdata/` — it is per-developer and was never shared, so it is not in version control. Everything in this plan and in `CLAUDE.md` invokes `-scheme bearlake-client`, which today works only because Xcode autocreates the scheme locally. Sharing it puts it in `xcshareddata/xcschemes/` where it is committed and resolves in a fresh clone.
6. **Add `Info.plist` with the ATS exception** (C13). File written at `bearlake-client/Info.plist`, `plutil -lint` clean, containing only `NSAppTransportSecurity → NSAllowsLocalNetworking = true`. **Build-settings half is a GUI step and is not done.**

    *Plan amendment.* This step originally said to set `GENERATE_INFOPLIST_FILE = NO` and hand-copy the generated keys across. **Prefer the merge instead:** leave `GENERATE_INFOPLIST_FILE = YES` and set only `INFOPLIST_FILE = Info.plist`. Xcode merges its `INFOPLIST_KEY_*` build settings into the supplied file, so the four generated keys this target uses (`UIApplicationSceneManifest_Generation`, `UIApplicationSupportsIndirectInputEvents`, `UILaunchScreen_Generation`, and both orientation lists) keep flowing from build settings rather than being frozen into a file that then silently rots when the template changes. Hand-copying them is the thing most likely to be got subtly wrong here.

    **✅ Merge behaviour verified on Xcode 26.0.1.** Built with `INFOPLIST_FILE=Info.plist GENERATE_INFOPLIST_FILE=YES` as command-line overrides; the built `.app`'s `Info.plist` contains **both** `NSAppTransportSecurity → NSAllowsLocalNetworking = true` **and** every generated key (`UILaunchScreen`, `UIApplicationSceneManifest`, both orientation lists, `CFBundleExecutable`). The fallback is not needed. Note that with `INFOPLIST_FILE` unset, the checked-in file is ignored **silently** — the build succeeds and ATS simply is not configured, which would surface much later as an unexplained localhost failure in Phase 2.
7. **Create the folder skeleton** from §3 and move the two template files. ✅ Done. `bearlake_clientApp.swift` → `App/BearLakeApp.swift` (via `git mv`, so history follows), struct renamed `bearlake_clientApp` → `BearLakeApp`, `ContentView.swift` deleted, and `PlaceholderView` renders the app name. Only folders that contain files are in git — empty ones exist on disk but git does not track them, and each later phase creates its own.
8. **Confirm C5 empirically.** ✅ **Done and passed.** The probe built, the symbol appeared in the binary (`nm`), and its string rendered on screen in the simulator. Probe and its reference in `PlaceholderView` deleted; the app rebuilds clean without them. **C5 is settled — create Swift files from the CLI for the rest of the project without touching Xcode.**
9. **Write one trivial test** (`#expect(true)`) purely to prove the test target runs from the CLI. ✅ Written at `bearlake-clientTests/ToolchainTests.swift`; **running it is blocked** on steps 1 and 5. It deliberately does not reference `BuildProbe`, so deleting the probe in step 8 cannot break the suite.
10. **Add a `.gitignore`.** ✅ Done. *(Plan correction: this step claimed "the repo has none, anywhere". Wrong — `bearlake-server/` and `bearlake-web/` each have one. What was missing was a **root** `.gitignore` and one for `bearlake-client/`.)* Added both, matching the existing per-app convention: root covers `.DS_Store`; `bearlake-client/` covers `build/`, `DerivedData/`, `xcuserdata/`, `*.xcuserdatad/`, `*.xcuserstate`, `.build/`, `.swiftpm/`. It deliberately does **not** ignore `xcshareddata/` — see step 5's scheme-sharing note. Then untracked the three already-committed files with `git rm --cached` (`.gitignore` alone will not untrack them); `git check-ignore` confirms all three are now ignored, and the working tree is finally clean.
11. ~~**Amend `CLAUDE.md`** (C5/C10)~~ — **done ahead of Phase 0**, in the same PR as this plan. The "new Swift files do not auto-add" agreement is corrected, the `-scheme BearLake` commands are now `bearlake-client`, the "never hand-edit `project.pbxproj`" rule is kept and split out, and the Swift-specific date, image-cache, and UIKit-exception rules from §2 are folded in. **One piece is deliberately left open:** the simulator destination is a `<device from the list above>` placeholder, since the real device name is unknowable until step 1 fixes `xcode-select`. Fill it in as part of step 3.

**Tests:** the placeholder test runs green via `xcodebuild test`.

**Gate:** §4, plus a screenshot of the placeholder app running in the simulator.

#### Phase 0 status — ✅ COMPLETE

Toolchain live (Xcode 26.0.1), all four GUI steps applied, and the gate met: **the app builds, installs, launches, and renders on the iPhone 17 simulator, and `xcodebuild test` runs green** (`ToolchainTests/testTargetRuns()` passed).

| # | Step | Status |
|---|---|---|
| 1 | Toolchain → Xcode | ✅ Xcode 26.0.1 (17A400) |
| 2 | Simulator runtime | ✅ two iOS 26.0 runtimes (no iOS 17 — see C4) |
| 3 | Destination recorded | ✅ `platform=iOS Simulator,name=iPhone 17` |
| 4 | Deployment target | ✅ **app target 17.0** (see the 17.6 note below) |
| 5 | Test target + shared scheme | ✅ `bearlake-clientTests` builds and runs; scheme in `xcshareddata/` |
| 6 | `Info.plist` | ✅ `INFOPLIST_FILE` set; ATS **and** all generated keys in the built bundle |
| 7 | Folder skeleton | ✅ Done |
| 8 | C5 proof | ✅ **Proven**, probe deleted |
| 9 | Placeholder test | ✅ Passes from the CLI |
| 10 | `.gitignore` + untrack | ✅ Done, tree clean |
| 11 | `CLAUDE.md` | ✅ Done in the plan's PR |

**Verified from the CLI against a build with no command-line overrides** — i.e. the persisted settings standing on their own:

```
NSAllowsLocalNetworking : true      MinimumOSVersion  : 17.0
UILaunchScreen          : present   SceneManifest     : present
orientations~iphone     : present
```

##### One discrepancy, deliberately not blocking: 17.6 vs 17.0

`IPHONEOS_DEPLOYMENT_TARGET` resolves to:

| Scope | Value |
|---|---|
| **app target `bearlake-client`** | **17.0** ✅ |
| project-level default | 17.6 |
| test target `bearlake-clientTests` | 17.6 |

Xcode's *Minimum Deployments* picker offers discrete point releases, and the project-level and inherited test-target values landed on **17.6**.

**The app target is the one that ships, and it is correct** — the built bundle reports `MinimumOSVersion 17.0`, so C1 is satisfied and no family member is excluded. The other two are harmless today: test code never ships, and the only installed runtimes are iOS 26 regardless.

Two reasons to tidy it anyway, next time the project is open in Xcode — **not worth a trip on its own**:

1. The project-level value is what any **new target** inherits. The plan creates none, so this is latent rather than active.
2. Anyone reading the project settings to answer *"what iOS do we support?"* gets 17.6, which contradicts C1 and this plan.

Fix: PROJECT → Info → *iOS Deployment Target* → **17.0**, and TARGET `bearlake-clientTests` → General → *Minimum Deployments* → **17.0**.

##### Gate evidence

- `xcodebuild build` → **BUILD SUCCEEDED**, no warnings surfaced
- `xcodebuild test` → `Test case 'ToolchainTests/testTargetRuns()' passed`
- Simulator screenshot: the placeholder renders "Bear Lake" with the SF Symbol, correct safe-area insets, stock styling

**Phase 1 is unblocked.** Swift files are created from the CLI with no Xcode involvement (C5, proven); `xcodebuild build` and `xcodebuild test` are the loop.

### Phase 1 — Domain models, block schema, and date utilities

Pure Swift, no networking, no UI. The most heavily tested phase in the plan.

**Steps:**

1. `Models/DTOs/` — `Codable` structs transcribed from `bearlake-web/src/types/api.ts`: `PublicUser`, `CalendarEvent`, `Announcement`, `QuickTip`, `InfoCategory`, `ArticleSummary`, `InfoArticle`, `SessionResult`, `AnnouncementPage`, `PresignResponse`. Request types are **exact** per C15.
2. `Models/Block.swift` — the block enum, `UnknownBlock`, and `JSONValue` (C30/C31). Custom `init(from:)` switching on `type`, falling through to `.unknown` and capturing the whole object.
3. `Models/EventDates.swift` — the `.allDay`/`.timed` enum (C24) with custom decoding driven by `isAllDay`.
4. `Utilities/CabinDate.swift` (C22–C29) — date-only parse/format without `Date`; inclusive range labelling ("Jul 16 – Jul 20, 2026"); month-grid enumeration (6×7, Sunday-start); "does this event fall on this day"; ISO instant formatting with `.withFractionalSeconds`.
5. `Utilities/YouTube.swift` — id extraction, ported from the web app's four URL shapes plus bare id.
6. `Models/Limits.swift` — every cap mirrored from `bearlake-web/src/types/limits.ts`, with a comment naming that file as the source.

**Tests (the priority area — spec §11.1, §11.4, §11.5, §11.6):**

- Date-only values never shift a day, asserted at **UTC−11, UTC+13, America/Denver, and UTC** via injected `TimeZone` (C26).
- A date-only string is never passed to a `Date` initializer (assert via the formatted output at the extreme zones above).
- Timed instants decode correctly **with fractional seconds**, and a fractional-seconds payload does not decode to `nil`.
- Both **2026 DST transitions** (Mar 8, Nov 1) round-trip to the right UTC instants.
- Inclusive end: a Jul 16–20 all-day event reports 5 days and labels *through Jul 20*.
- Month grid: 42 cells, Sunday-start, correct in-month flags, identical across timezones.
- Block decoding: one valid block of each type; an **unknown type round-trips structurally identical** (compare parsed values, C32); a malformed *known* block is rejected rather than silently reclassified as unknown.
- Block ids are lowercase UUIDs and unique within an article.
- YouTube: all four URL shapes, a bare id, and junk rejection.

**Gate:** §4 (steps 3–4 are a no-op this phase; note that in the PR).

#### Phase 1 status — ✅ COMPLETE

**101 tests green, zero build warnings**, on a clean build. Gate steps 3–4 are the anticipated no-op: this phase adds no screens, so the simulator run confirms only that the app still launches with the new code linked in.

| # | Step | Status |
|---|---|---|
| 1 | `Models/DTOs/` | ✅ (less `InfoArticle`, moved to step 2) |
| 2 | `Models/Block.swift` + `JSONValue` + `InfoArticle` | ✅ |
| 3 | `Models/EventDates.swift` | ✅ |
| 4 | `Utilities/CabinDate.swift` | ✅ |
| 5 | `Utilities/YouTube.swift` | ✅ |
| 6 | `Models/Limits.swift` | ✅ |

**Step order changed twice, both times because Swift compiles the target as a whole** and a step that cannot build cannot be tested:
- `InfoArticle` moved from step 1 to step 2 — it carries decoded blocks.
- Step 6 (`Limits`) was taken before step 5 (`YouTube`), which references the id pattern.

##### Mutation check

The §6 checklist asks whether the new tests actually fail when the feature breaks. The C22 bug was injected deliberately — `components(fromDateOnly:)` rewritten to build a `Date` from the literal via `ISO8601DateFormatter` — and **12 tests failed**, including `neverShifts` at the negative-offset zones, all three all-day label tests, and the DST arithmetic. Reverted; 101 green again. The date suite is load-bearing.

##### Two implicit defaults, deliberate

`CabinDate.init(timeZone: = .current, locale: = .current)` and `todayDateOnly(now: = Date())`. These are default *parameters*, not inline reads, so every test pins them explicitly and C26 is satisfied where it matters. They exist because the viewer's own zone is the correct default for display (C28). Worth knowing they are there: a ViewModel that constructs `CabinDate()` silently picks up the device zone, which is right for production and wrong in a test that forgets to inject.

##### Resolved during Phase 1: `SWIFT_DEFAULT_ACTOR_ISOLATION`

The Xcode template set **`SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`** on the app target, making every type implicitly `@MainActor`. That contradicts **C2**, which enforces isolation by hand (`@MainActor` on ViewModels, `actor` for shared mutable state) — a strategy that only works when types are nonisolated by default. Left in place it would have fought Phase 2's `actor TokenStore`, `actor ImageCache`, and off-main-actor `APIClient` directly.

Symptom: a clean test run emitted **49** *"main actor-isolated conformance … cannot be used in nonisolated context; this is an error in the Swift 6 language mode"* warnings — 10 after step 1, growing with every type. The app target itself built clean; the warnings appeared only where the nonisolated test target touched the DTOs.

**✅ Fixed.** Set to `nonisolated` on both configurations of the app target (Xcode GUI). Verified on a clean run: **0 warnings, 101 tests green**. The test target needs no change — unset already resolves to nonisolated there.

Not worked around by scattering `nonisolated` across individual types, which would have hidden a setting that should simply be correct and had to be undone later.

---

### Phase 2 — Networking, Keychain, and the session

**Steps:**

1. `Utilities/AppConfig.swift` (C12).
2. `Services/APIError.swift` (C17) — decode `{error:{code,message}}`; map a non-JSON 500 to `INTERNAL`; map transport failures to a friendly offline error.
3. `Services/KeychainStore.swift` (C20) — save/read/delete one refresh-token item, `kSecAttrAccessibleAfterFirstUnlock`.
4. `Services/TokenStore.swift` — `actor`; access token in memory, refresh token via the Keychain; `clear()` wipes both.
5. `Services/BearLakeAPI.swift` — the protocol: one method per endpoint in §2.2/C16.
6. `Services/APIClient.swift` — `URLSession` implementation: base URL, JSON headers, bearer injection, **204 → `Void`**, error mapping, and the **single-flight 401 refresh** (C18).
7. `Services/FakeAPI.swift` (test target) — an in-memory conforming double every later phase's ViewModel tests use.

**Tests (against a stubbed `URLProtocol`):**

- Success decodes each envelope shape (named wrapper vs. bare object).
- `DELETE`/`logout` 204 with an empty body succeeds rather than throwing a decode error.
- An error body maps to `APIError` with the right `code` and `status`; a non-JSON 500 still yields `INTERNAL`; an **unrecognized code keeps the server's message**.
- One 401 triggers exactly **one** refresh and **one** retry.
- **Two concurrent 401s trigger exactly one refresh call** (single-flight, C18).
- A failed refresh clears the Keychain and does not retry again.
- Keychain round-trip: save → read → delete → read returns nil.

**Manual verification (C13):** with `bearlake-server` running locally, make one real request from the simulator and confirm ATS does not block it. If it does, apply the Phase 0 step 6 exception and re-verify. **Do not proceed until a real localhost request succeeds.**

**Gate:** §4. Run `/security-review` on this phase's diff.

---

### Phase 3 — Auth, the session gate, and the app shell

**Steps:**

1. `AuthViewModel` (`@Observable`, `@MainActor`) — `login`, `logout`, `changePassword`, current user, and a **boot restore**: if a Keychain refresh token exists, refresh before first paint behind a splash.
2. `LoginView` — email + password, one **generic** error for every failure except `RATE_LIMITED` (shown with its message). No "create account", no "forgot password"; static text directing the user to contact a family admin.
3. `ChangePasswordView` — serves both flows off one view. **Forced**: presented when `mustChangePassword`, non-dismissable, **no tab bar**. **Voluntary**: from the ☰ settings sheet, requires the current password. Client-side length ≥ 12 and match check; server `VALIDATION_ERROR` messages shown verbatim.
4. Global `PASSWORD_CHANGE_REQUIRED` interception in `APIClient` → flips the session into the forced state from wherever it fires.
5. `RootTabView` (C47) — Calendar | Home | Information, opening on Home, `NavigationStack` per tab.
6. `SettingsSheet` — change password, sign out.
7. `BearLakeApp` — switches between splash, login, forced change, and the tab shell.

**Tests:** login success stores tokens and lands in the app; failed login shows the generic message and stores nothing; `mustChangePassword` blocks the tab shell; a successful change clears the gate and installs the new token pair; boot restore with a valid token yields a signed-in app; boot restore with a rejected token lands on login with the Keychain cleared; logout clears the Keychain even when the network call fails.

**Gate:** §4 + a simulator pass through: launch → login → (forced change if applicable) → tab shell → ☰ → sign out → relaunch lands on login. Screenshot each.

---

### Phase 4 — Home and All Announcements

**Steps:**

1. `HomeView` (storyboard, spec §8.1): **Announcements** section — most recent, each with date and body, footer link *Older announcements →*. **Upcoming** section — the **next three** events, each with date range and title, footer link *Calendar →*.
2. "Next three" is computed from a range query starting now; formatting goes through `CabinDate` (C27), including inclusive multi-day labelling.
3. `AllAnnouncementsView` — full reverse-chronological list, **"Load more"** driving the opaque cursor (`{items, nextCursor}`; `nextCursor: nil` ends).
4. Admin-only add/edit/delete for announcements (C48). Edit sends **`{body}` only** — `postedAt` is displayed, never editable (server D18). Body ≤ 5000 with a live counter. Delete behind a confirmation.
5. Errors via `.alert` bound to the ViewModel; empty states for both sections.

**Tests:** the next-three selection picks the right events and ignores past ones; pagination appends without duplicates and stops at the end; create/edit/delete send **exactly** the allowed fields; over-length bodies are blocked before the request; delete is not issued unless confirmed; a `FORBIDDEN` surfaces the server's message.

**Gate:** §4 + simulator: create → edit → paginate → delete against the local API, then clean up the rows.

---

### Phase 5 — Calendar month grid and day detail

**Steps:**

1. `CalendarMonthView` — header with a **year selector** and **month stepper** (storyboard), and the `+` control.
2. **Selection rules, exactly** (spec §8.3, C27): selected day defaults to **today** on first load; changing the **month** selects the **1st** of that month; changing the **year** moves month and day to the **corresponding date** in the new year (clamped for Feb 29).
3. `MonthGrid` — 6×7 Sunday-start; today marked; selected day marked; events indicated per day.
4. `DayDetailView` — header `< July 17, 2026 >` with `+`. **All-day and multi-day events pin to the top**; timed events in an **hour-by-hour scrollable column** (storyboard shows 12am…11pm with events positioned by hour).
5. Fetch window = visible month **± 1 month**, refetched on month/year navigation. `GET /events` **requires** `start` and `end`; window ≤ 366 days.
6. Tapping empty space in the day detail opens Create Event with that date pre-populated; tapping an event opens Edit if admin-or-creator, else read-only Detail.

**Tests (spec §11.3, §11.4):** month change → 1st; year change → corresponding date, and Feb 29 → Feb 28 in a non-leap year; the range query sends `start`/`end` and stays within 366 days; **a multi-day event appears on every day it spans**; an event starting before or ending after the window still appears; month navigation refetches; the hour column places a timed event in the right row at several timezones.

**Gate:** §4 + simulator: navigate months and years, confirm the selection rules by eye, confirm a multi-day event spans correctly.

---

### Phase 6 — Create / Edit Event and Event Detail

**Steps:**

1. `EventEditorView` — one view, two modes; edit pre-populates. Fields: title, notes, **all-day toggle**, starts (date + time), ends (date + time).
2. All-day on → **time fields disappear**, dates remain. Toggling **converts the held values** so the submitted shape always matches `isAllDay` (C24) — mixing shapes is a server 400.
3. **Inline date picker below the field being edited** (storyboard): focusing *Starts* places it under Starts; focusing *Ends* moves it under Ends.
4. **X** cancels — discards in create mode, reverts in edit mode; **confirm if data was entered**. **Checkmark** saves.
5. **Delete Event** in edit mode only, behind a confirmation.
6. `EventDetailView` — title, formatted range, notes; edit control only for the creator or an admin.
7. Client-side validation mirroring the server: title 1–200, notes ≤ 5000, timed `start < end`, all-day `start ≤ end`.

**Tests (the priority area):** an all-day event round-trips as date-only strings with an inclusive end and **never shifts a day** at UTC−11/UTC+13; timed events serialize to correct UTC instants across **both 2026 DST transitions**; toggling all-day rewrites the payload shape in both directions; validation blocks bad ranges before any request; delete requires confirmation; a member editing another member's event never sees the edit control (and the server would refuse anyway).

**Gate:** §4 + simulator: create one all-day and one timed event, confirm both land on the right days, survive relaunch, then delete them.

---

### Phase 7 — Information: quick tips, categories, article lists

**Steps:**

1. `InformationView` (storyboard, spec §8.6): **Quick tips** section — short items, admin-only `+`. **Knowledge base** section — category rows with chevrons, admin-only `+`.
2. Quick tips ordered by `sortOrder`; admin create/edit/delete; body ≤ 1000; delete behind confirmation.
3. `CategoryView` — article titles with chevrons, admin-only `+`. Admins additionally see **Draft/Published badges** (C38).
4. Category create/rename/delete for admins; **`CATEGORY_NOT_EMPTY` (409)** surfaces the server's specific guidance, not a generic failure.
5. **New article** (draft-first): title → creates a `draft` immediately → navigates to the editor. Block editing only ever happens against a persisted article, because `POST /uploads/presign` requires an existing `articleId`.
6. Treat quick-tip bodies as **sensitive** (gate codes, key locations): never logged.

**Tests:** quick-tip and category CRUD hit the right endpoints with exact fields; `CATEGORY_NOT_EMPTY` renders its specific message; the article list shows both statuses for an admin; "New article" creates with `status: "draft"` and navigates to the returned id; every delete requires confirmation.

**Gate:** §4 + simulator walkthrough of both sections.

---

### Phase 8 — Article renderer

**Steps:**

1. `ArticleView` renders the block array **in order**: heading, paragraph, bullet list, image, video.
2. `Blocks/UnknownBlockView` renders **nothing** (spec §8.8) — no placeholder, no error.
3. `CachedAsyncImage` + `ImageCache` (C35/C36) — keyed on the S3 key, with a loading state and a failure state that does not look like a crash.
4. `VideoBlockView` — `WKWebView` over `youtube-nocookie.com/embed/{id}` (C37), in its own file, sized to a 16:9 frame.
5. Admin-only edit control in the toolbar.
6. Dynamic Type and dark mode across every block type.

**Tests (spec §11.6):** an article containing an **unknown block type renders without crashing** and contributes no view; blocks render in array order; an image block with an expired/failed URL degrades gracefully; the image cache is keyed by `key` — two fetches with **different presigned URLs for the same key** hit the cache once.

**Gate:** §4 + simulator: render a real article containing all five block types (author it in the web app first), confirm the image loads and the video plays inline.

---

### Phase 9 — Article editor (admin) and image upload

**Steps:**

1. `ArticleEditorView` — title, category picker, **Draft/Published** toggle, Save, and a dirty indicator. Loads the full article plus `updatedAt`.
2. A reorderable `List` with **`.onMove`** and **`.onDelete`** (native, unlike the web app's buttons — this is what `List` gives us for free and it is the platform-idiomatic gesture).
3. `+` menu appends: Heading, Paragraph, Bullet list, Photo, Video. Every new block gets a fresh UUID (C33).
4. Tapping a block opens a **focused editor for that block alone**. Caps: heading ≤ 200, paragraph ≤ 10 000, bullets 1–100 items × ≤ 500, caption ≤ 300.
5. **Unknown blocks render read-only** ("Unsupported block — preserved on save") and round-trip unchanged (C31).
6. `Services/ImageUpload.swift` (C41/C42/C43) — PhotosPicker → validate → downscale → presign → PUT → store key, with progress.
7. **Save**: strip every transient `url` (C34), validate locally, `PATCH` with `updatedAt`. On **409 `STALE_ARTICLE`** run the C39 flow.
8. Explicit save only; warn on dismissing with unsaved changes.

**Tests (spec §11.5):** adding one of each block type produces an article the server accepts; ids are UUIDs and unique; move/delete reorder and remove correctly and preserve ids; **an unknown block round-trips structurally identical through load → unrelated edit → save**; **no write payload contains `url`**; a 409 shows the reload/copy prompt and never silently overwrites; oversize and disallowed types are rejected **before** any presign call; the presigned `Content-Length` equals the bytes actually PUT.

**Gate:** §4 + simulator: build a real article with all five block types **including a genuine photo upload to S3**, publish it, relaunch, and confirm the image renders from a fresh presigned URL. Delete the test article and its S3 object afterwards. Run `/code-review` on the diff.

---

### Phase 10 — SwiftData offline cache

Deferred to here deliberately: caching is only meaningful once there is something to cache, and retrofitting one coherent layer beats half-wiring it into eight phases.

**Steps:**

1. `Models/Cache/` — `@Model` types mirroring the read DTOs, server `id` as `@Attribute(.unique)`; blocks as a JSON `Data` blob (C45).
2. A `CacheStore` that upserts from every successful fetch response.
3. Each read ViewModel: attempt the network; on success update the cache and render; on failure render the cache **read-only** with an offline banner and mutating controls disabled (C46). With no cache, show an actionable error.
4. Cache cleared on sign-out — the next user must not see the previous user's content.
5. `.refreshable` pull-to-refresh on the list screens.

**Tests:** a successful fetch populates the cache; a failed fetch with a populated cache yields cached content plus the offline flag; a failed fetch with an empty cache yields an error, not an empty list; sign-out empties the store; blocks survive the `Data` round-trip including unknown blocks.

**Gate:** §4 + simulator with **network disabled** (Simulator → Features → Network Link Conditioner, or stop the local API): confirm cached content shows read-only with the banner, and that mutating controls are unavailable.

---

### Phase 11 — Hardening, accessibility, and install

**Steps:**

1. **Full §6 checklist review of the whole codebase** — a fresh pass, as if reviewing a stranger's PR.
2. **Security sweep**, each item verified by grep and/or a test, results recorded at the bottom of this file:
   - Refresh token **only** in the Keychain; nothing sensitive in `UserDefaults`; access token never persisted.
   - No `print`/`NSLog`/`os_log` carrying an announcement body, quick-tip body, password, or token (spec §6.5).
   - No force-unwrap (`!`) or `try!` in non-test code.
   - Every mutating request body matches its documented field set exactly (C15).
   - Every destructive action confirms first.
   - No `url` in any write payload (C34).
3. **Accessibility pass**: VoiceOver labels on every control; Dynamic Type through XXL on every screen; dark mode; hit targets; the block list operable without gestures. Verified in the simulator with VoiceOver on.
4. **Date audit**: grep for `Calendar.current`, `TimeInterval` arithmetic, and any `Date` constructed from a date-only string. Expect zero outside `CabinDate`.
5. **Performance sanity**: a month with many events and a long article scroll without stutter; images do not reload on every appearance (C35).
6. **Run on a physical iPhone**: point `AppConfig` at production, confirm login and one read of each screen. Note that `localhost` does not resolve from a device (C13) — use the deployed API.
7. **Production smoke test** against the deployed pair, mirroring the web app's: login → forced-change gate if applicable → create/edit/delete one of each resource → article with a real uploaded image → sign out. Clean up test data and S3 objects. Save the transcript to `docs/`.
8. Decide distribution (TestFlight vs. direct install) — **out of scope for this plan**; raise it with the user rather than assuming.
9. Tag `client-v1`.

**Gate:** all of the above recorded as checked in this file, suite green, smoke transcript committed.

---

## 6. Per-phase review checklist

Applied at every phase gate (step 5 of §4):

- [ ] Views are pure — no networking, business logic, or date math in a `body`.
- [ ] ViewModels do not `import SwiftUI`.
- [ ] All API access goes through the `BearLakeAPI` protocol; no `URLSession` outside `Services/`.
- [ ] Request bodies contain exactly the documented fields (C15).
- [ ] All date handling goes through `CabinDate`; no `Calendar.current` inline; no `Date` built from a date-only string; no `TimeInterval` arithmetic.
- [ ] No force-unwrap, no `try!`, no `fatalError` on a reachable path.
- [ ] Refresh token only in the Keychain; access token only in memory.
- [ ] No sensitive value (announcement/quick-tip body, password, token) reaches any log.
- [ ] Every destructive action confirms first; every failure surfaces something actionable.
- [ ] Every new View has a `#Preview` with realistic sample data.
- [ ] New controls have VoiceOver labels; the screen survives Dynamic Type XXL and dark mode.
- [ ] Data loads in `.task { }`, not `.onAppear`.
- [ ] New tests fail if the feature is broken (spot-check by reverting one behavior).
- [ ] Spec cross-check: re-read the relevant spec/storyboard section; confirm no invented screens, fields, or flows.

---

## 7. Skills and MCP servers

**Strongly consider adding:**

- **An Xcode/simulator MCP server** (e.g. `XcodeBuildMCP`). This is the highest-leverage addition available for this plan. Everything in §4's gate — build, run, install to a booted simulator, capture a screenshot, read the app's logs — is otherwise raw `xcodebuild`/`simctl` parsing. It is the iOS analogue of what `claude-in-chrome` was for the web app, and the web build showed how much real-bug-catching came from driving the actual UI (two production bugs found in the browser that unit tests missed). **Decide before Phase 3**, the first phase with meaningful UI. If it is not added, the fallback is the `simctl` command set in §8, which works but produces far more terminal noise.

**Use routinely:**

- **`run` skill** — the standard way to launch and drive the app when verifying a change works for real rather than only in tests.
- **`/code-review`** — on the working diff at each phase gate before opening the PR. Worth `ultra` for **Phase 2** (auth/Keychain/refresh) and **Phase 9** (editor), the two phases where a subtle bug is most costly.
- **`/security-review`** — on **Phase 2** (token storage, Keychain, refresh rotation) and **Phase 9** (upload pipeline) specifically.

**Use situationally:**

- **`/simplify`** — after Phase 9, when the block views have accumulated and duplication is easiest to see.
- **Railway CLI / MCP** — for API logs when a client request fails in a way the client cannot explain. The API is already deployed; `railway logs` is faster than guessing.
- **AWS CLI** (already authenticated) — deleting test S3 objects after Phases 9 and 11.
- **`Explore` agent** — for "how did the web app handle X" lookups across `bearlake-web/`, which is a large verified reference. Useful, but only on request.

**Explicitly not applicable:**

- **`claude-in-chrome`** — there is no browser in this app. The one exception is authoring a test article in the deployed web app before Phase 8's renderer check, which is a web task, not an iOS one.
- **`dataviz`, `artifact-*`** — no charts, and Artifacts govern claude.ai pages, not a shipped iOS app.

---

## 8. Command reference

Fill in `$SIM` from Phase 0 step 3.

```bash
# from bearlake-client/
SIM='platform=iOS Simulator,name=iPhone 17'      # ← record the real name in Phase 0

xcodebuild build -scheme bearlake-client -destination "$SIM" -quiet
xcodebuild test  -scheme bearlake-client -destination "$SIM" -quiet 2>&1 | tail -30

# simulator control
xcrun simctl list devices available
xcrun simctl boot "iPhone 17" ; open -a Simulator

# build to a known output dir, then install + launch (simpler than parsing
# -showBuildSettings for BUILT_PRODUCTS_DIR)
xcodebuild build -scheme bearlake-client -destination "$SIM" -derivedDataPath .build -quiet
APP=.build/Build/Products/Debug-iphonesimulator/bearlake-client.app
xcrun simctl install booted "$APP"
xcrun simctl launch booted hansen.bearlake-client
xcrun simctl io booted screenshot /tmp/bearlake-screen.png

# .build/ is local scratch — add it to .gitignore in Phase 0

# the local API this app talks to in DEBUG
cd ../bearlake-server && npm run dev
```

---

## 9. Execution notes

- **One branch per phase, PR to `master` at the end of each**, matching the server and web workflow.
- Phases are strictly ordered; each commit leaves the suite green.
- Anything discovered mid-build that contradicts this plan → stop, amend §2 with the new decision and its rationale, then continue. The plan stays truthful to what was built.
- **The API is authoritative and already deployed.** If the client needs a capability the API lacks, that is a **server change first** (and a server plan amendment) — never a client workaround.
- **`bearlake-web/` is the reference implementation, not a thing to copy blindly.** Where this plan deliberately diverges — HEIC re-encoding (C41), native `.onMove` reordering (Phase 9), no cabin-time echo (C28) — the divergence is recorded with its reason.
- **Three contracts must stay identical across both clients** or they will silently disagree: the block schema (C30/C31), date-only all-day handling with inclusive ends (C22/C25), and `updatedAt` optimistic locking (C39).
- **`CLAUDE.md` has been amended to match this plan** (landed with it, ahead of Phase 0). Swift files *do* auto-add (C5), the scheme is `bearlake-client` not `BearLake` (C10), and the Swift date, image-cache, and `WKWebView` rules from §2 are now in the always-loaded guidance rather than only here. Only the simulator device name is still a placeholder — Phase 0 step 3 fills it in. **If this plan and `CLAUDE.md` ever disagree again, this plan is the newer document and wins; fix `CLAUDE.md` in the same task rather than leaving both in circulation.**
