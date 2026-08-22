//
//  EventDatesTests.swift
//  bearlake-clientTests
//

import Foundation
import Testing
@testable import bearlake_client

private let decoder = APICoding.makeDecoder()
private let encoder = APICoding.makeEncoder()

private func event(
    isAllDay: Bool,
    startsAt: String,
    endsAt: String
) throws -> CalendarEvent {
    let json = Data("""
    {
      "id": "e1", "title": "Stay", "notes": null,
      "startsAt": "\(startsAt)", "endsAt": "\(endsAt)", "isAllDay": \(isAllDay),
      "createdBy": "u1", "creatorDisplayName": "Zach",
      "createdAt": "2026-08-01T12:00:00.000Z",
      "updatedAt": "2026-08-01T12:00:00.000Z"
    }
    """.utf8)
    return try decoder.decode(CalendarEvent.self, from: json)
}

struct EventDatesTests {
    @Test("an all-day event projects to date-only strings")
    func allDayProjection() throws {
        let dates = try #require(
            try event(isAllDay: true, startsAt: "2026-07-16", endsAt: "2026-07-20").dates
        )
        #expect(dates == .allDay(start: "2026-07-16", end: "2026-07-20"))
        #expect(dates.isAllDay)
    }

    @Test("a timed event projects to instants")
    func timedProjection() throws {
        let dates = try #require(
            try event(
                isAllDay: false,
                startsAt: "2026-07-16T18:00:00.000Z",
                endsAt: "2026-07-16T21:00:00.000Z"
            ).dates
        )
        guard case .timed(let start, let end) = dates else {
            Issue.record("expected a timed event")
            return
        }
        #expect(start.timeIntervalSince1970 == 1_784_224_800)
        #expect(end.timeIntervalSince1970 == 1_784_235_600)
        #expect(dates.isAllDay == false)
    }

    /// The C22 bug, asserted directly: the value that survives must be the
    /// original text. Anything that went through `Date` and back would come
    /// out as the previous day for a negative-offset viewer.
    @Test("all-day bounds are never routed through Date")
    func allDayNeverBecomesDate() throws {
        let dates = try #require(
            try event(isAllDay: true, startsAt: "2026-01-01", endsAt: "2026-01-01").dates
        )
        guard case .allDay(let start, let end) = dates else {
            Issue.record("expected an all-day event")
            return
        }
        #expect(start == "2026-01-01")
        #expect(end == "2026-01-01")
        // The failure mode this prevents, shown explicitly: parsing that same
        // literal as an instant yields UTC midnight, which is Dec 31 in Utah.
        let asInstant = try #require(APICoding.date(fromISO: "2026-01-01T00:00:00.000Z"))
        var utah = Calendar(identifier: .gregorian)
        utah.timeZone = try #require(TimeZone(identifier: "America/Denver"))
        #expect(utah.component(.day, from: asInstant) == 31)
        #expect(utah.component(.month, from: asInstant) == 12)
    }

    @Test("date-only strings compare chronologically as text")
    func lexicographicOrdering() {
        #expect("2026-07-16" < "2026-07-20")
        #expect("2026-09-01" < "2026-10-01")
        #expect("2026-12-31" < "2027-01-01")
    }

    @Test("wire values keep the shape the server expects")
    func wireValues() throws {
        let allDay = EventDates.allDay(start: "2026-07-16", end: "2026-07-20")
        #expect(allDay.wireValues.startsAt == "2026-07-16")
        #expect(allDay.wireValues.endsAt == "2026-07-20")

        let start = try #require(APICoding.date(fromISO: "2026-07-16T18:00:00.000Z"))
        let timed = EventDates.timed(start: start, end: start.addingTimeInterval(3600))
        #expect(timed.wireValues.startsAt == "2026-07-16T18:00:00.000Z")
        #expect(timed.wireValues.endsAt.hasSuffix("Z"))
    }

    /// Mixing an `isAllDay` flag with the other shape's date format is a
    /// server 400, so requests are built from `EventDates` rather than by
    /// hand.
    @Test("a create request cannot disagree with its own isAllDay flag")
    func createRequestStaysConsistent() throws {
        let request = CreateEventRequest(
            title: "Reunion",
            notes: nil,
            dates: .allDay(start: "2026-07-16", end: "2026-07-20")
        )
        #expect(request.isAllDay)
        #expect(request.startsAt == "2026-07-16")

        let fields = try #require(
            try JSONSerialization.jsonObject(with: try encoder.encode(request)) as? [String: Any]
        )
        #expect(fields["isAllDay"] as? Bool == true)
        #expect(fields["startsAt"] as? String == "2026-07-16")
    }

    @Test("setDates moves the flag and both bounds together")
    func patchSetsDatesTogether() throws {
        var patch = UpdateEventRequest()
        patch.setDates(.allDay(start: "2026-07-16", end: "2026-07-20"))

        let fields = try #require(
            try JSONSerialization.jsonObject(with: try encoder.encode(patch)) as? [String: Any]
        )
        #expect(Set(fields.keys) == ["isAllDay", "startsAt", "endsAt"])
        #expect(fields["isAllDay"] as? Bool == true)
    }

    @Test("a timed event with unparseable instants reports nil, not a wrong date")
    func malformedTimedEvent() throws {
        let broken = try event(isAllDay: false, startsAt: "not-a-date", endsAt: "also-not")
        #expect(broken.dates == nil)
    }

    /// Both 2026 US DST transitions. The instants are unambiguous; what
    /// matters is that they survive decode and re-encode without drifting.
    @Test("DST transition instants round-trip exactly")
    func dstRoundTrip() throws {
        for iso in ["2026-03-08T09:00:00.000Z", "2026-11-01T08:00:00.000Z"] {
            let parsed = try #require(APICoding.date(fromISO: iso))
            #expect(APICoding.iso(from: parsed) == iso)
        }
    }
}
