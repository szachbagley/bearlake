//
//  CacheModelTests.swift
//  bearlake-clientTests
//
//  Phase 10, step 1. The DTO ↔ `@Model` conversions.
//

import Foundation
import Testing
@testable import bearlake_client

private let decoder = APICoding.makeDecoder()

struct CacheModelTests {
    /// C45 stores blocks as a JSON blob precisely so this holds. An unknown
    /// block is a shape this build cannot describe, so it is the case that
    /// would break a per-block-type schema — and the one §11.5 cares about.
    @Test("blocks survive the Data round-trip, unknown blocks included")
    func blocksRoundTrip() throws {
        let futureJSON = """
        {"id":"cccccccc-0000-4000-8000-000000000001","type":"table",
         "columns":["Item","Where"],"rows":[["Life jackets","Boathouse"]],
         "meta":{"width":3,"compact":true,"note":null}}
        """
        let unknown = try decoder.decode(Block.self, from: Data(futureJSON.utf8))

        let original: [Block] = [
            .heading(id: "b1", text: "Before you go out"),
            .paragraph(id: "b2", text: "Check the fuel."),
            .bullets(id: "b3", items: ["Life jackets", "Radio"]),
            .image(id: "b4", key: "articles/a1/photo.jpg", caption: "The dock", url: nil),
            .video(id: "b5", videoId: "dQw4w9WgXcQ", caption: nil),
            unknown,
        ]

        let cached = try CachedArticle(InfoArticle.fixture(blocks: original))
        let restored = try cached.dto.blocks

        #expect(restored == original, "including the block this build cannot describe")
    }

    /// C34: a presigned URL expires in fifteen minutes, so persisting one
    /// would bake in an expiry. It is unrepresentable on write by
    /// construction — this asserts the cache inherits that rather than
    /// working around it.
    @Test("a cached image block keeps its key and drops the presigned url")
    func imageBlockKeepsKeyOnly() throws {
        let article = InfoArticle.fixture(blocks: [
            .image(
                id: "b1", key: "articles/a1/photo.jpg", caption: nil,
                url: "https://bucket.s3.amazonaws.com/articles/a1/photo.jpg?X-Amz-Expires=900"
            ),
        ])

        let cached = try CachedArticle(article)
        #expect(
            String(data: cached.blocksData, encoding: .utf8)?.contains("X-Amz") == false,
            "no expiring url reaches the store"
        )

        guard case .image(_, let key, _, let url) = try cached.dto.blocks[0] else {
            Issue.record("expected an image block"); return
        }
        #expect(key == "articles/a1/photo.jpg")
        #expect(url == nil, "offline, the photo shows unavailable rather than a dead url")
    }

    /// C22, one layer lower. Storing these as `Date` would reintroduce the
    /// UTC-midnight bug inside the cache, where it would be harder to see.
    @Test("all-day dates stay strings through the cache")
    func allDayDatesStayStrings() {
        let event = CalendarEvent.fixture(
            startsAt: "2026-07-16", endsAt: "2026-07-20", isAllDay: true
        )
        let restored = CachedEvent(event).dto

        #expect(restored.startsAt == "2026-07-16")
        #expect(restored.endsAt == "2026-07-20", "C25: the last day, inclusive")
        #expect(restored == event)
    }

    @Test("a timed event round-trips unchanged")
    func timedEventRoundTrips() {
        let event = CalendarEvent.fixture(
            startsAt: "2026-07-16T15:00:00.000Z",
            endsAt: "2026-07-16T18:30:00.000Z",
            isAllDay: false
        )
        #expect(CachedEvent(event).dto == event)
    }

    @Test("announcements, quick tips, and categories round-trip unchanged")
    func simpleModelsRoundTrip() {
        let announcement = Announcement.fixture(body: "Gate code is 4417 until Friday.")
        #expect(CachedAnnouncement(announcement).dto == announcement)

        let tip = QuickTip.fixture(body: "Keys are in the lockbox.", sortOrder: 3)
        #expect(CachedQuickTip(tip).dto == tip)

        let category = InfoCategory.fixture(title: "Boat", sortOrder: 2)
        #expect(CachedCategory(category).dto == category)
    }

    @Test("an article summary keeps its draft status through the cache")
    func summaryKeepsStatus() {
        let draft = ArticleSummary.fixture(title: "Half-written", status: .draft)
        let restored = CachedArticleSummary(draft).dto

        #expect(restored == draft)
        #expect(restored.status == .draft, "a draft must not resurface as published")
    }

    /// `update(from:)` exists because replacing the object would violate the
    /// unique constraint on `id`. This is the upsert path in Step 2.
    @Test("updating in place overwrites every field")
    func updateInPlaceOverwrites() throws {
        let first = Announcement.fixture(id: "a1", body: "Original")
        let cached = CachedAnnouncement(first)

        let second = Announcement.fixture(id: "a1", body: "Corrected")
        cached.update(from: second)

        #expect(cached.dto == second)
        #expect(cached.id == "a1", "identity is stable across the update")
    }

    @Test("updating an article in place replaces its blocks")
    func updateArticleReplacesBlocks() throws {
        let cached = try CachedArticle(
            InfoArticle.fixture(id: "a1", blocks: [.paragraph(id: "b1", text: "Old")])
        )
        try cached.update(
            from: InfoArticle.fixture(id: "a1", blocks: [.paragraph(id: "b1", text: "New")])
        )

        #expect(try cached.dto.blocks == [.paragraph(id: "b1", text: "New")])
    }
}
