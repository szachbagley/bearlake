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
