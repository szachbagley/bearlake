//
//  DTOTests.swift
//  bearlake-clientTests
//

import Foundation
import Testing
@testable import bearlake_client

/// Fixtures are copied from real API responses so a drift in the contract
/// shows up here rather than at runtime.
struct DTODecodingTests {
    let decoder = APICoding.makeDecoder()

    @Test("PublicUser decodes, including a null lastLoginAt")
    func decodesUser() throws {
        let json = Data("""
        {
          "id": "9f9a1eb9-0000-4000-8000-000000000001",
          "displayName": "Zach",
          "email": "zach@example.com",
          "role": "admin",
          "mustChangePassword": false,
          "isActive": true,
          "lastLoginAt": null,
          "createdAt": "2026-08-01T12:00:00.000Z",
          "updatedAt": "2026-08-01T12:00:00.000Z"
        }
        """.utf8)

        let user = try decoder.decode(PublicUser.self, from: json)
        #expect(user.role == .admin)
        #expect(user.isAdmin)
        #expect(user.lastLoginAt == nil)
        #expect(user.createdAt.timeIntervalSince1970 == 1_785_585_600)
    }

    /// C23 — the failure this is guarding is silent: without
    /// `.withFractionalSeconds` the parse returns nil and reads as missing
    /// data rather than as a decode error.
    @Test("timestamps decode with fractional seconds")
    func decodesFractionalSeconds() throws {
        let parsed = APICoding.date(fromISO: "2026-01-01T00:00:00.000Z")
        #expect(parsed != nil)
        #expect(parsed?.timeIntervalSince1970 == 1_767_225_600)
    }

    /// The symmetric failure: a formatter configured *with* fractional
    /// seconds refuses a timestamp *without* them. Both shapes must parse.
    @Test("timestamps decode without fractional seconds too")
    func decodesWithoutFractionalSeconds() throws {
        let parsed = APICoding.date(fromISO: "2026-01-01T00:00:00Z")
        #expect(parsed != nil)
        #expect(parsed?.timeIntervalSince1970 == 1_767_225_600)
    }

    @Test("a non-timestamp is a decode error, not a silent nil")
    func rejectsGarbageTimestamp() {
        #expect(APICoding.date(fromISO: "not a date") == nil)

        let json = Data("""
        {"id":"a","body":"b","postedAt":"nope","createdBy":"c",
         "createdAt":"2026-08-01T12:00:00.000Z","updatedAt":"2026-08-01T12:00:00.000Z"}
        """.utf8)
        #expect(throws: DecodingError.self) {
            _ = try decoder.decode(Announcement.self, from: json)
        }
    }

    @Test("instants round-trip through encode and decode")
    func roundTripsInstant() throws {
        let original = "2026-07-16T18:30:45.123Z"
        let date = try #require(APICoding.date(fromISO: original))
        #expect(APICoding.iso(from: date) == original)
    }

    /// C22 — the event DTO must hand back exactly what the wire carried.
    /// A date-only string that got parsed and reformatted would already have
    /// lost a day for any negative-offset viewer.
    @Test("an all-day event keeps its date-only strings verbatim")
    func keepsDateOnlyStringsVerbatim() throws {
        let json = Data("""
        {
          "id": "e1", "title": "Reunion", "notes": null,
          "startsAt": "2026-07-16", "endsAt": "2026-07-20", "isAllDay": true,
          "createdBy": "u1", "creatorDisplayName": "Zach",
          "createdAt": "2026-08-01T12:00:00.000Z",
          "updatedAt": "2026-08-01T12:00:00.000Z"
        }
        """.utf8)

        let event = try decoder.decode(CalendarEvent.self, from: json)
        #expect(event.startsAt == "2026-07-16")
        #expect(event.endsAt == "2026-07-20")
        #expect(event.isAllDay)
    }

    @Test("announcement page decodes a null nextCursor as nil")
    func decodesAnnouncementPage() throws {
        let json = Data("""
        {"items": [], "nextCursor": null}
        """.utf8)
        let page = try decoder.decode(AnnouncementPage.self, from: json)
        #expect(page.items.isEmpty)
        #expect(page.nextCursor == nil)
    }
}

/// C15 — the server uses `z.strictObject`, so an extra key is a 400 rather
/// than a silently ignored field. These assert the exact wire shape.
struct RequestEncodingTests {
    let encoder = APICoding.makeEncoder()

    private func object(_ value: some Encodable) throws -> [String: Any] {
        let data = try encoder.encode(value)
        let parsed = try JSONSerialization.jsonObject(with: data)
        return try #require(parsed as? [String: Any])
    }

    @Test("login sends exactly email and password")
    func encodesLogin() throws {
        let fields = try object(LoginRequest(email: "a@b.com", password: "secret"))
        #expect(Set(fields.keys) == ["email", "password"])
    }

    @Test("an omitted optional is absent, not null")
    func omitsNilOptionals() throws {
        let fields = try object(CreateQuickTipRequest(body: "Gate code"))
        #expect(Set(fields.keys) == ["body"])
    }

    /// The reason `Patchable` exists. `Optional` would collapse these two
    /// cases and make "clear the notes" unrepresentable.
    @Test("patch omits an unchanged field but sends null to clear it")
    func distinguishesUnchangedFromNull() throws {
        var patch = UpdateEventRequest()
        patch.title = "New title"

        let unchanged = try object(patch)
        #expect(Set(unchanged.keys) == ["title"])
        #expect(unchanged["notes"] == nil)

        patch.notes = .setNull
        let cleared = try object(patch)
        #expect(Set(cleared.keys) == ["title", "notes"])
        #expect(cleared["notes"] is NSNull)

        patch.notes = .set("Bring life jackets")
        let assigned = try object(patch)
        #expect(assigned["notes"] as? String == "Bring life jackets")
    }

    @Test("Patchable(clearing:) maps nil to an explicit null")
    func clearingInitializer() {
        #expect(Patchable(clearing: "text") == .set("text"))
        #expect(Patchable(clearing: String?.none) == .setNull)
    }

    @Test("an empty patch encodes to an empty object")
    func encodesEmptyPatch() throws {
        // The server rejects this with "Provide at least one field to change",
        // so the UI must not send it — but the encoding itself must be honest
        // rather than inventing keys.
        let fields = try object(UpdateEventRequest())
        #expect(fields.isEmpty)
    }
}

// MARK: - C15 sweep (Phase 11, step 2)

/// Every write payload in the app, pinned to the exact key set the server's
/// `z.strictObject` schemas accept. An extra key is a 400 at runtime, so
/// these are the cheapest possible place to catch one.
struct StrictBodySweepTests {
    let encoder = APICoding.makeEncoder()

    private func keys(_ value: some Encodable) throws -> Set<String> {
        let data = try encoder.encode(value)
        let parsed = try JSONSerialization.jsonObject(with: data)
        return Set(try #require(parsed as? [String: Any]).keys)
    }

    @Test("announcement writes send only body")
    func announcements() throws {
        #expect(try keys(CreateAnnouncementRequest(body: "x")) == ["body"])
        #expect(try keys(UpdateAnnouncementRequest(body: "x")) == ["body"])
    }

    @Test("quick tip writes send only what was set")
    func quickTips() throws {
        #expect(try keys(CreateQuickTipRequest(body: "x")) == ["body"])
        #expect(try keys(CreateQuickTipRequest(body: "x", sortOrder: 2)) == ["body", "sortOrder"])
        #expect(try keys(UpdateQuickTipRequest(body: "x")) == ["body"])
        #expect(try keys(UpdateQuickTipRequest(sortOrder: 1)) == ["sortOrder"])
    }

    @Test("category writes send only what was set")
    func categories() throws {
        #expect(try keys(CreateCategoryRequest(title: "Boat")) == ["title"])
        #expect(try keys(UpdateCategoryRequest(title: "Boat")) == ["title"])
    }

    @Test("article create sends the documented fields and no url")
    func articleCreate() throws {
        let request = CreateArticleRequest(
            categoryId: "c1", title: "T",
            blocks: [.image(id: "b1", key: "articles/a/x.jpg", caption: nil, url: nil)],
            status: .draft
        )
        #expect(try keys(request) == ["categoryId", "title", "blocks", "status"])

        let data = try encoder.encode(request)
        let json = try #require(String(data: data, encoding: .utf8))
        #expect(json.contains("\"url\"") == false, "C34: a presigned url never goes up")
    }

    /// The optimistic-lock token is mandatory on an article PATCH (C39), so
    /// it must be present even when nothing else is.
    @Test("article update always carries updatedAt")
    func articleUpdate() throws {
        let bare = UpdateArticleRequest(updatedAt: Date())
        #expect(try keys(bare) == ["updatedAt"])

        var full = UpdateArticleRequest(updatedAt: Date())
        full.title = "T"
        full.status = .published
        #expect(try keys(full) == ["updatedAt", "title", "status"])
    }

    /// An image block that was *read* carries a url; encoding it must still
    /// drop it, because the same `Block` value goes back up on save.
    @Test("an image block read with a url encodes without one")
    func imageBlockDropsURLOnWrite() throws {
        let block = Block.image(
            id: "b1", key: "articles/a/x.jpg", caption: "Dock",
            url: "https://bucket.s3.amazonaws.com/articles/a/x.jpg?X-Amz-Signature=abc"
        )
        let json = try #require(String(data: try encoder.encode(block), encoding: .utf8))
        #expect(json.contains("X-Amz") == false)
        #expect(json.contains("\"url\"") == false)
        #expect(json.contains("\"key\""))
    }

    @Test("event writes send the documented fields")
    func events() throws {
        let create = CreateEventRequest(
            title: "Stay", notes: nil, dates: .allDay(start: "2026-07-16", end: "2026-07-20")
        )
        #expect(try keys(create) == ["isAllDay", "title", "startsAt", "endsAt"],
                "a nil note is absent, not null")

        var update = UpdateEventRequest()
        update.setDates(.allDay(start: "2026-07-16", end: "2026-07-20"))
        #expect(try keys(update) == ["isAllDay", "startsAt", "endsAt"])
    }

    @Test("presign sends exactly what the server signs")
    func presign() throws {
        let request = PresignUploadRequest(
            articleId: "a1", contentType: "image/jpeg", contentLength: 1234
        )
        #expect(try keys(request) == ["articleId", "contentType", "contentLength"])
    }

    @Test("password change sends only the two passwords")
    func passwordChange() throws {
        #expect(
            try keys(ChangePasswordRequest(currentPassword: "a", newPassword: "b"))
                == ["currentPassword", "newPassword"]
        )
    }
}
