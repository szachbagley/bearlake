//
//  Event.swift
//  bearlake-client
//

import Foundation

/// Named `CalendarEvent`, not `Event`, matching the web app — and because
/// `Event` collides with types in several Apple frameworks.
///
/// `startsAt` and `endsAt` are kept as **raw wire strings**. Their meaning
/// depends on `isAllDay`: an ISO instant when false, a `YYYY-MM-DD` date-only
/// string when true. Do not parse them here — Phase 1 step 3 adds an
/// `EventDates` projection that makes the two shapes a compiler-enforced
/// question (C24), and building a `Date` from a date-only string is the bug
/// C22 exists to prevent.
struct CalendarEvent: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let title: String
    let notes: String?
    let startsAt: String
    let endsAt: String
    let isAllDay: Bool
    let createdBy: String
    let creatorDisplayName: String
    let createdAt: Date
    let updatedAt: Date
}

/// Create is a discriminated union on the wire, but both branches carry the
/// same field names — only the *format* of `startsAt`/`endsAt` differs. One
/// struct is therefore an exact match for either branch (C15), and step 3
/// adds an initializer that takes `EventDates` so the shapes cannot be mixed.
struct CreateEventRequest: Encodable, Sendable {
    let isAllDay: Bool
    let title: String
    let notes: String?
    let startsAt: String
    let endsAt: String
}

/// PATCH is a partial. `notes` is `.nullish()` on the server, so it needs the
/// three-way `Patchable` — omitted keeps the stored notes, null clears them.
/// Every other field is plain-optional: absent means unchanged, and none of
/// them is nullable.
struct UpdateEventRequest: Encodable, Sendable {
    var isAllDay: Bool?
    var title: String?
    var notes: Patchable<String> = .unchanged
    var startsAt: String?
    var endsAt: String?

    enum CodingKeys: String, CodingKey {
        case isAllDay, title, notes, startsAt, endsAt
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(isAllDay, forKey: .isAllDay)
        try container.encodeIfPresent(title, forKey: .title)
        try container.encodePatch(notes, forKey: .notes)
        try container.encodeIfPresent(startsAt, forKey: .startsAt)
        try container.encodeIfPresent(endsAt, forKey: .endsAt)
    }
}

struct ListEventsResponse: Decodable, Sendable {
    let events: [CalendarEvent]
}
