//
//  OfflineFallbackTests.swift
//  bearlake-clientTests
//
//  Phase 10, step 3. The C46 contract, per read ViewModel:
//
//    - a successful fetch populates the cache
//    - a failed fetch with a populated cache renders the cache and raises the
//      offline flag, with no error alert on top of the banner
//    - a failed fetch with an empty cache raises the error, never an empty
//      list — "there is nothing here" is a different claim from "we could
//      not ask"
//

import Foundation
import SwiftData
import Testing
@testable import bearlake_client

private let offline = APIError(
    status: 0, code: "NETWORK_ERROR",
    message: "You appear to be offline. Check your connection and try again."
)

@MainActor
private func makeStore() throws -> CacheStore {
    let container = try #require(CacheStore.makeContainer(inMemory: true))
    let zone = try #require(TimeZone(identifier: "America/Denver"))
    return CacheStore(context: ModelContext(container), dates: CabinDate(timeZone: zone))
}

// MARK: - Home

@MainActor
struct HomeOfflineTests {
    @Test("a successful load populates the cache")
    func successPopulatesCache() async throws {
        let store = try makeStore()
        let api = FakeAPI()
        await api.seed(announcements: [.fixture(id: "a1", body: "Gate code changed.")])

        let model = HomeViewModel(api: api, cache: store)
        await model.load()

        #expect(model.isOffline == false)
        #expect(store.announcements().map(\.id) == ["a1"])
    }

    @Test("a failed load with a populated cache renders the cache behind the banner")
    func failureServesCache() async throws {
        let store = try makeStore()
        let api = FakeAPI()
        await api.seed(announcements: [.fixture(id: "a1", body: "Gate code changed.")])

        let model = HomeViewModel(api: api, cache: store)
        await model.load()
        await api.setAlwaysFails(offline)
        await model.load()

        #expect(model.isOffline)
        #expect(model.announcements.map(\.id) == ["a1"])
        #expect(
            model.errorMessage == nil,
            "the banner already says it; an alert would be the same news twice"
        )
    }

    @Test("a failed load with an empty cache surfaces the error, not an empty screen")
    func failureWithoutCacheErrors() async throws {
        let store = try makeStore()
        let api = FakeAPI()
        await api.setAlwaysFails(offline)

        let model = HomeViewModel(api: api, cache: store)
        await model.load()

        #expect(model.isOffline == false, "there is no saved copy to be offline with")
        #expect(model.errorMessage != nil)
        #expect(model.announcements.isEmpty)
    }

    /// The cached path must land on the same three events as the live one.
    @Test("cached upcoming events keep the next-three selection")
    func cachedUpcomingIsSelected() async throws {
        let store = try makeStore()
        let api = FakeAPI()
        let now = Date(timeIntervalSince1970: 1_784_000_000)  // 2026-07-13
        await api.seed(events: [
            .fixture(id: "e1", startsAt: "2026-07-16", endsAt: "2026-07-17"),
            .fixture(id: "e2", startsAt: "2026-07-18", endsAt: "2026-07-19"),
            .fixture(id: "e3", startsAt: "2026-07-20", endsAt: "2026-07-21"),
            .fixture(id: "e4", startsAt: "2026-07-22", endsAt: "2026-07-23"),
        ])

        let model = HomeViewModel(api: api, now: { now }, cache: store)
        await model.load()
        let live = model.upcoming.map(\.id)

        await api.setAlwaysFails(offline)
        await model.load()

        #expect(model.isOffline)
        #expect(model.upcoming.map(\.id) == live, "same three, same order")
        #expect(model.upcoming.count == 3)
    }
}

// MARK: - Announcements list

@MainActor
struct AnnouncementsOfflineTests {
    @Test("the full list falls back to the cache")
    func listFallsBack() async throws {
        let store = try makeStore()
        let api = FakeAPI()
        await api.seed(announcements: [.fixture(id: "a1"), .fixture(id: "a2")])

        let model = AnnouncementsViewModel(api: api, cache: store)
        await model.load()
        await api.setAlwaysFails(offline)
        await model.load()

        #expect(model.isOffline)
        #expect(model.announcements.count == 2)
        #expect(model.errorMessage == nil)
    }

    /// The server's cursor is opaque and the cache is not a page of it, so
    /// offering "load more" offline would only produce a failure.
    @Test("offline clears the pagination cursor")
    func offlineHasNoCursor() async throws {
        let store = try makeStore()
        let api = FakeAPI()
        await api.seed(announcements: [.fixture(id: "a1")])

        let model = AnnouncementsViewModel(api: api, cache: store)
        await model.load()
        await api.setAlwaysFails(offline)
        await model.load()

        #expect(model.canLoadMore == false)
    }
}

// MARK: - Calendar

@MainActor
struct CalendarOfflineTests {
    @Test("the calendar falls back to cached events")
    func calendarFallsBack() async throws {
        let store = try makeStore()
        let api = FakeAPI()
        await api.seed(events: [.fixture(id: "e1", startsAt: "2026-07-16", endsAt: "2026-07-20")])

        let model = CalendarViewModel(api: api, now: { Date(timeIntervalSince1970: 1_784_000_000) }, cache: store)
        await model.load()
        #expect(model.events.map(\.id) == ["e1"])

        await api.setAlwaysFails(offline)
        await model.load()

        #expect(model.isOffline)
        #expect(model.events.map(\.id) == ["e1"])
        #expect(model.errorMessage == nil)
    }

    /// A window served from cache was never actually fetched, so it must not
    /// be recorded as loaded — otherwise the retry never happens.
    ///
    /// The scenario is launching with no signal: the cache is warm from a
    /// previous session, this session has fetched nothing. When the network
    /// returns, `loadIfNeeded` has to go and get the real thing.
    @Test("an offline load does not mark the window as fetched")
    func offlineDoesNotMarkWindowLoaded() async throws {
        let store = try makeStore()
        let event = CalendarEvent.fixture(id: "e1", startsAt: "2026-07-16", endsAt: "2026-07-20")
        // Warm from a previous session, not from a fetch in this one.
        store.save(events: [event], window: nil)

        let api = FakeAPI()
        await api.seed(events: [event])
        await api.setAlwaysFails(offline)

        let model = CalendarViewModel(
            api: api, now: { Date(timeIntervalSince1970: 1_784_000_000) }, cache: store
        )
        await model.load()
        #expect(model.isOffline, "showing the saved copy")
        let callsBefore = await api.callCount("listEvents")

        // The network is back. loadIfNeeded must try again rather than
        // treating the cached render as a successful fetch.
        await api.setAlwaysFails(nil)
        await model.loadIfNeeded()

        #expect(await api.callCount("listEvents") > callsBefore, "it retried")
        #expect(model.isOffline == false)
    }

    /// C46, and the reason it matters here specifically: an editor opened
    /// offline could not save, so the work would be lost at the last step.
    @Test("offline blocks creating an event and forces read-only opens")
    func offlineBlocksEditing() async throws {
        let store = try makeStore()
        let api = FakeAPI()
        let event = CalendarEvent.fixture(id: "e1", startsAt: "2026-07-16", endsAt: "2026-07-20")
        await api.seed(events: [event])
        let model = CalendarViewModel(api: api, now: { Date(timeIntervalSince1970: 1_784_000_000) }, cache: store)
        await model.load()

        // Online, the creator gets the editor.
        model.requestOpen(event, as: .fixture())
        #expect(model.pendingAction == .edit(event))
        model.pendingAction = nil

        await api.setAlwaysFails(offline)
        await model.load()
        #expect(model.isOffline)

        model.requestCreate(on: "2026-07-16")
        #expect(model.pendingAction == nil, "no editor to create into")

        model.requestOpen(event, as: .fixture())
        #expect(model.pendingAction == .view(event), "read-only, even for the creator")
    }
}

// MARK: - Information

@MainActor
struct InformationOfflineTests {
    @Test("quick tips and categories fall back to the cache")
    func informationFallsBack() async throws {
        let store = try makeStore()
        let api = FakeAPI()
        await api.seed(
            quickTips: [.fixture(id: "t1", body: "Keys are in the lockbox.")],
            categories: [.fixture(id: "c1", title: "Boat")]
        )

        let model = InformationViewModel(api: api, cache: store)
        await model.load()
        await api.setAlwaysFails(offline)
        await model.load()

        #expect(model.isOffline)
        #expect(model.quickTips.map(\.id) == ["t1"])
        #expect(model.categories.map(\.id) == ["c1"])
        #expect(model.errorMessage == nil)
    }

    @Test("an empty cache still surfaces the error")
    func informationWithoutCacheErrors() async throws {
        let store = try makeStore()
        let api = FakeAPI()
        await api.setAlwaysFails(offline)

        let model = InformationViewModel(api: api, cache: store)
        await model.load()

        #expect(model.isOffline == false)
        #expect(model.errorMessage != nil)
    }

    @Test("a category's article list falls back to the cache")
    func categoryFallsBack() async throws {
        let store = try makeStore()
        let api = FakeAPI()
        let category = InfoCategory.fixture(id: "c1", title: "Boat")
        await api.setArticleSummaries("c1", [.fixture(id: "s1", categoryId: "c1")])

        let model = CategoryViewModel(category: category, api: api, cache: store)
        await model.load()
        await api.setAlwaysFails(offline)
        await model.load()

        #expect(model.isOffline)
        #expect(model.articles.map(\.id) == ["s1"])
    }

    @Test("an article falls back to the cache, blocks and all")
    func articleFallsBack() async throws {
        let store = try makeStore()
        let api = FakeAPI()
        let article = InfoArticle.fixture(id: "ar1", title: "Starting the boat", blocks: [
            .heading(id: "b1", text: "Fuel"),
            .paragraph(id: "b2", text: "Fill before returning."),
        ])
        await api.setArticle(article)

        let model = ArticleViewModel(articleID: "ar1", initialTitle: "Starting the boat", api: api, cache: store)
        await model.load()
        await api.setAlwaysFails(offline)
        await model.load()

        #expect(model.isOffline)
        #expect(model.article == article)
        #expect(model.blocks.count == 2)
        #expect(model.errorMessage == nil)
    }

    @Test("an uncached article surfaces the error rather than an empty page")
    func uncachedArticleErrors() async throws {
        let store = try makeStore()
        let api = FakeAPI()
        await api.setAlwaysFails(offline)

        let model = ArticleViewModel(articleID: "nope", initialTitle: "Missing", api: api, cache: store)
        await model.load()

        #expect(model.isOffline == false)
        #expect(model.errorMessage != nil)
        #expect(model.article == nil)
    }
}

// MARK: - Sign-out (step 4)

@MainActor
struct SignOutClearsCacheTests {
    /// The cache holds one family's private content — gate codes, key
    /// locations, and an admin's unpublished drafts. Handing the phone to
    /// another family member and signing in must not surface any of it.
    @Test("signing out empties the cache")
    func logoutClearsCache() async throws {
        let store = try makeStore()
        store.save(announcements: [.fixture(id: "a1", body: "Gate code is 4417.")],
                   replacingAll: true)
        store.save(quickTips: [.fixture(id: "t1", body: "Keys are in the lockbox.")])
        #expect(store.isEmpty == false)

        let api = FakeAPI()
        let auth = AuthViewModel(api: api, tokens: TokenStore()) { store.clear() }
        await auth.logout()

        #expect(store.isEmpty, "nothing of the previous user's is left behind")
    }

    /// The other way out of a session. Both paths run through the same
    /// private `signedOut()`, so neither can be the one that forgets.
    @Test("an expired session also empties the cache")
    func sessionExpiryClearsCache() async throws {
        let store = try makeStore()
        store.save(categories: [.fixture(id: "c1", title: "Boat")])
        #expect(store.isEmpty == false)

        let api = FakeAPI()
        let auth = AuthViewModel(api: api, tokens: TokenStore()) { store.clear() }
        auth.sessionExpired()

        #expect(store.isEmpty)
    }
}
