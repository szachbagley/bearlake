//
//  EventDates.swift
//  bearlake-client
//

import Foundation

/// The two shapes an event's dates can take, made a compiler-enforced
/// question (C24).
///
/// An all-day event is a **date range**, not a timestamp range. Its bounds
/// stay `String` from decode to display and are never converted to `Date`
/// (C22): `ISO8601DateFormatter` reads a bare `2026-07-16` as UTC midnight,
/// which renders as July 15 for every negative-offset viewer — including
/// Utah, where the cabin is. Comparison is lexicographic, which is
/// chronological for `YYYY-MM-DD`.
///
/// No view ever sees a raw string pair; it pattern-matches this instead.
enum EventDates: Equatable, Sendable {
    /// Date-only bounds, `YYYY-MM-DD`. `end` is the **last day, inclusive**
    /// (C25) — Jul 16–20 reads as *through Jul 20*, not *until Jul 20*.
    case allDay(start: String, end: String)
    /// Instants, with `end` exclusive as usual for a timed range.
    case timed(start: Date, end: Date)

    var isAllDay: Bool {
        if case .allDay = self { return true }
        return false
    }

    /// The wire values for `startsAt`/`endsAt`, in the shape the server
    /// expects for this event's `isAllDay` flag. Mixing the shapes is a 400,
    /// so requests are built from here rather than assembled by hand.
    var wireValues: (startsAt: String, endsAt: String) {
        switch self {
        case .allDay(let start, let end):
            return (start, end)
        case .timed(let start, let end):
            return (APICoding.iso(from: start), APICoding.iso(from: end))
        }
    }
}

extension CalendarEvent {
    /// The decoded date shape. Built from the raw wire strings rather than
    /// stored, so `CalendarEvent` stays an exact mirror of the response.
    ///
    /// Returns nil only when a timed event's instants fail to parse, which
    /// would mean the server sent something that is not ISO-8601.
    var dates: EventDates? {
        if isAllDay {
            return .allDay(start: startsAt, end: endsAt)
        }
        guard
            let start = APICoding.date(fromISO: startsAt),
            let end = APICoding.date(fromISO: endsAt)
        else {
            return nil
        }
        return .timed(start: start, end: end)
    }
}

extension CreateEventRequest {
    /// Builds a create request from an `EventDates`, so the `isAllDay` flag
    /// and the format of the two date strings cannot disagree.
    init(title: String, notes: String?, dates: EventDates) {
        let wire = dates.wireValues
        self.init(
            isAllDay: dates.isAllDay,
            title: title,
            notes: notes,
            startsAt: wire.startsAt,
            endsAt: wire.endsAt
        )
    }
}

extension UpdateEventRequest {
    /// Sets all three date-related fields together. Toggling `isAllDay`
    /// without supplying matching bounds is a server 400, because the patch is
    /// merged onto the stored event and revalidated as a whole.
    mutating func setDates(_ dates: EventDates) {
        let wire = dates.wireValues
        isAllDay = dates.isAllDay
        startsAt = wire.startsAt
        endsAt = wire.endsAt
    }
}
