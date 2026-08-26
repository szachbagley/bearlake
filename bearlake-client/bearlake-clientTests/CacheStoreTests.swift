//
//  CacheStoreTests.swift
//  bearlake-clientTests
//
//  Phase 10, step 2. Every test runs against a fresh in-memory container, so
//  they never touch the simulator's real store and cannot leak into each
//  other under Swift Testing's parallel execution.
//

import Foundation
import SwiftData
import Testing
@testable import bearlake_client

@MainActor
private func makeStore(zone: String = "America/Denver") throws -> CacheStore {
    let container = try #require(CacheStore.makeContainer(inMemory: true))
    let dates = CabinDate(timeZone: try #require(TimeZone(identifier: zone)))
    return CacheStore(context: ModelContext(container), dates: dates)
}

@MainActor
struct CacheStoreUpsertTests {
    @Test("a fetch populates the cache")
    func fetchPopulates() throws {
        let store = try makeStore()
        store.save(announcements: [
            .fixture(id: "a1", body: "First"),
            .fixture(id: "a2", body: "Second"),
        ], replacingAll: true)

        #expect(store.announcements().count == 2)
    }

    /// The reason `id` carries `@Attribute(.unique)`.
    @Test("refetching the same ids updates rather than duplicating")
    func refetchUpserts() throws {
        let store = try makeStore()
        store.save(announcements: [.fixture(id: "a1", body: "Original")], replacingAll: false)
        store.save(announcements: [.fixture(id: "a1", body: "Corrected")], replacingAll: false)

        let cached = store.announcements()
        #expect(cached.count == 1, "one row, not two")
        #expect(cached.first?.body == "Corrected")
    }

    /// A later page must not wipe the pages already held.
    @Test("appending a page keeps earlier pages, replacing a first page does not")
    func paginationRespectsScope() throws {
        let store = try makeStore()
        store.save(announcements: [.fixture(id: "a1")], replacingAll: true)
        store.save(announcements: [.fixture(id: "a2")], replacingAll: false)
        #expect(store.announcements().count == 2, "loadMore appends")

        store.save(announcements: [.fixture(id: "a3")], replacingAll: true)
        #expect(
            store.announcements().map(\.id) == ["a3"],
            "a first page is the newest N and is authoritative"
        )
    }

    @Test("announcements come back newest first")
    func announcementsSortNewestFirst() throws {
        let store = try makeStore()
        let older = Announcement(
            id: "old", body: "Older", postedAt: Date(timeIntervalSince1970: 1_000),
            createdBy: "u1", createdAt: Date(), updatedAt: Date()
        )
        let newer = Announcement(
            id: "new", body: "Newer", postedAt: Date(timeIntervalSince1970: 9_000),
            createdBy: "u1", createdAt: Date(), updatedAt: Date()
        )
        store.save(announcements: [older, newer], replacingAll: true)

        #expect(store.announcements().map(\.id) == ["new", "old"])
        #expect(store.announcements(limit: 1).map(\.id) == ["new"], "the limit takes the newest")
    }

    /// These endpoints return the whole set, so anything missing was deleted.
    @Test("a complete-list fetch drops what the server no longer has")
    func completeListPrunes() throws {
        let store = try makeStore()
        store.save(quickTips: [.fixture(id: "t1"), .fixture(id: "t2")])
        store.save(quickTips: [.fixture(id: "t1")])
        #expect(store.quickTips().map(\.id) == ["t1"])

        store.save(categories: [.fixture(id: "c1"), .fixture(id: "c2")])
        store.save(categories: [.fixture(id: "c2")])
        #expect(store.categories().map(\.id) == ["c2"])
    }

    @Test("article summaries prune only within their own category")
    func summaryPruneIsScoped() throws {
        let store = try makeStore()
        store.save(articleSummaries: [
            .fixture(id: "s1", categoryId: "catA"),
        ], categoryID: "catA")
        store.save(articleSummaries: [
            .fixture(id: "s2", categoryId: "catB"),
        ], categoryID: "catB")

        // Re-fetching catA empty must not touch catB.
        store.save(articleSummaries: [], categoryID: "catA")

        #expect(store.articleSummaries(categoryID: "catA").isEmpty)
        #expect(store.articleSummaries(categoryID: "catB").map(\.id) == ["s2"])
    }

    @Test("an article round-trips through the store with its blocks")
    func articleRoundTrips() throws {
        let store = try makeStore()
        let article = InfoArticle.fixture(id: "a1", blocks: [
            .heading(id: "b1", text: "Fuel"),
            .bullets(id: "b2", items: ["Fill before returning"]),
        ])
        store.save(article: article)

        let restored = try #require(store.article(id: "a1"))
        #expect(restored == article)
        #expect(store.article(id: "missing") == nil)
    }
}

// MARK: - Event pruning

@MainActor
struct CacheStoreEventTests {
    private let july = "2026-07-01"..."2026-07-31"

    @Test("events in the window are cached")
    func eventsCached() throws {
        let store = try makeStore()
        store.save(events: [.fixture(id: "e1", startsAt: "2026-07-16", endsAt: "2026-07-20")],
                   window: july)

        #expect(store.events().map(\.id) == ["e1"])
    }

    /// "Is the cabin booked" is the question the app exists to answer, so a
    /// cancelled stay must not linger offline.
    @Test("an event deleted on the server is pruned from the cached window")
    func deletedEventIsPruned() throws {
        let store = try makeStore()
        store.save(events: [
            .fixture(id: "e1", startsAt: "2026-07-16", endsAt: "2026-07-20"),
            .fixture(id: "e2", startsAt: "2026-07-22", endsAt: "2026-07-24"),
        ], window: july)

        // The second stay was cancelled; the refetch returns only the first.
        store.save(events: [
            .fixture(id: "e1", startsAt: "2026-07-16", endsAt: "2026-07-20"),
        ], window: july)

        #expect(store.events().map(\.id) == ["e1"])
    }

    /// The prune is window-scoped: fetching July must not empty August.
    @Test("pruning one window leaves other months alone")
    func pruneIsWindowScoped() throws {
        let store = try makeStore()
        store.save(events: [.fixture(id: "aug", startsAt: "2026-08-10", endsAt: "2026-08-12")],
                   window: "2026-08-01"..."2026-08-31")
        store.save(events: [.fixture(id: "jul", startsAt: "2026-07-16", endsAt: "2026-07-20")],
                   window: july)

        // Refetch July, now empty. August is untouched.
        store.save(events: [], window: july)

        #expect(store.events().map(\.id) == ["aug"])
    }

    /// A timed event's membership is decided by `CabinDate`, so the prune
    /// inherits the DST- and zone-correct rule rather than restating it.
    @Test("a timed event is pruned by the same day rule as an all-day one")
    func timedEventPruned() throws {
        let store = try makeStore()
        store.save(events: [
            .fixture(
                id: "timed",
                startsAt: "2026-07-16T15:00:00.000Z",
                endsAt: "2026-07-16T18:00:00.000Z",
                isAllDay: false
            ),
        ], window: july)
        #expect(store.events().count == 1)

        store.save(events: [], window: july)
        #expect(store.events().isEmpty)
    }

    @Test("saving with no window upserts without pruning anything")
    func noWindowMeansNoPrune() throws {
        let store = try makeStore()
        store.save(events: [.fixture(id: "e1")], window: july)
        store.save(events: [.fixture(id: "e2")], window: nil)

        #expect(Set(store.events().map(\.id)) == ["e1", "e2"])
    }
}

// MARK: - Sign-out

@MainActor
struct CacheStoreClearTests {
    /// Step 4. A member must not inherit an admin's cached drafts, and no
    /// one should see the previous user's announcements.
    @Test("sign-out empties every table")
    func clearEmptiesEverything() throws {
        let store = try makeStore()
        store.save(announcements: [.fixture(id: "a1")], replacingAll: true)
        store.save(events: [.fixture(id: "e1")], window: nil)
        store.save(quickTips: [.fixture(id: "t1")])
        store.save(categories: [.fixture(id: "c1")])
        store.save(articleSummaries: [.fixture(id: "s1", categoryId: "c1")], categoryID: "c1")
        store.save(article: .fixture(id: "ar1"))
        #expect(store.isEmpty == false)

        store.clear()

        #expect(store.isEmpty, "nothing survives sign-out")
        #expect(store.announcements().isEmpty)
        #expect(store.events().isEmpty)
        #expect(store.quickTips().isEmpty)
        #expect(store.categories().isEmpty)
        #expect(store.articleSummaries(categoryID: "c1").isEmpty)
        #expect(store.article(id: "ar1") == nil)
    }
}
