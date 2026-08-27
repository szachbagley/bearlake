# iOS client — production smoke test

**Date:** 2026-08-26
**Build:** `client-phase-11`, **Release** configuration (`AppConfig` → `https://bearlake-server-production.up.railway.app/api/v1`)
**Account:** throwaway production **member**, created by the owner in the web app and deactivated afterwards
**Plan reference:** Phase 11, step 7

## Why a member, and what that means

A member was chosen so a mistake during the run could not reach the family's real
data through an admin-only destructive path. The trade is that the admin half of
step 7 — create/edit/delete announcements, quick tips, categories, and an article
with a real uploaded image — **is not covered by this transcript**. Those paths are
verified against the local API and by the test suite, but not against production.
See "Not covered" below.

What a member run does cover that an admin run would not: it proves production
**authorization** from a real client, which is testing priority #2.

## Results

| # | Step | Result |
|---|---|---|
| 1 | Login with the one-time temporary password | ✅ |
| 2 | Forced password-change gate | ✅ fired on production — "Your account was set up with a temporary password." **No tab bar, no dismissal** |
| 3 | Change password | ✅ gate lifted, tab bar appeared, real production content loaded |
| 4 | Home | ✅ production announcement rendered; **no "New announcement" control** (member) |
| 5 | Information | ✅ production category listed; **no "New quick tip" / "New category" controls**; quick-tip rows not tappable |
| 6 | Category → articles | ✅ empty state used the **member** wording ("Articles in this category will appear here"), not the admin "Add one with the plus button"; no add control. No drafts visible |
| 7 | Calendar | ✅ **"New event" control present** — members may create events. The role split is exactly right |
| 8 | Create event | ✅ written to production; day cell became "has events" |
| 9 | Edit event | ✅ tapping opened the **editor** (creator), not the read-only detail; `Delete Event` present, which is edit-mode only. Title change persisted |
| 10 | Delete event | ✅ confirmed first — "Delete this event? This can't be undone." Day cell returned to no events |
| 11 | Re-login with the new password | ✅ **no forced-change gate** — the change persisted server-side |
| 12 | Sign out | ✅ **after a fix** — see below |
| 13 | Cleanup | ✅ the created event was deleted in step 10; production is back to its prior state. Account deactivated by the owner |

Nothing pre-existing in production was modified or deleted. The only write was one
event, created and then removed.

## Two defects found, both Release-only

Neither was reachable from the test suite, because the suite runs against Debug.

### 1. The Release build did not compile

Found immediately: step 7 needs a Release build, because that is the configuration
whose `AppConfig` points at production. It failed with 39 errors.

**Every phase up to this one built Debug.** The configuration that ships had never
been built once.

`PreviewSupport.swift` is correctly `#if DEBUG`-guarded so its doubles never reach a
shipping binary — but the `#Preview` macro's generated code is compiled in *every*
configuration, and all 23 files with previews referenced `PreviewAPI` / `.preview()`.
Fixed by guarding the preview blocks themselves.

### 2. The app crashed on sign-out — `SIGSEGV`

```
AppComposition.init() closure #4
  → CacheStore.clear()
    → Foundation: type metadata completion function for Predicate
      → swift_getGenericMetadata
        → EXC_BAD_ACCESS (SIGSEGV)
```

`clear()` looped `CacheSchema.models`, which is `[any PersistentModel.Type]`, and
handed each **existential metatype** to SwiftData's generic `delete(model:)`. That
forces the runtime to instantiate generic metadata for a `Predicate` it cannot see
statically. Debug survives it; an optimised build segfaults inside `libswiftCore`.

**The consequence was worse than a crash.** Sign-out is what empties the cached
announcement and quick-tip bodies — gate codes, where the keys are hidden — from
disk (Phase 10, step 4). A crash there left them there.

Fixed by listing the six model types concretely and making the private helper
generic, so the concrete type stays visible to the compiler. `CacheSchema.modelCount`
is a tripwire: adding a `@Model` without updating `clear()` now fails a test rather
than silently leaving a table full after sign-out.

**Verified after the fix:** re-ran login → sign-out on the Release build against
production. Returned cleanly to the login screen, and no new crash report was
written.

## Not covered by this run

- **Admin CRUD against production** — announcements, quick tips, categories, articles.
- **A real image upload to production S3** from the client.

Both need an admin credential. They are covered against the local API and by the
suite, but the deployed pair has not been exercised through them from iOS.

## Suite at time of run

**421 tests green, zero warnings.** Release builds with zero errors and zero warnings.
