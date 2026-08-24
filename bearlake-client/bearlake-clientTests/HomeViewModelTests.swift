//
//  HomeViewModelTests.swift
//  bearlake-clientTests
//

import Foundation
import Testing
@testable import bearlake_client

/// Pinned so "now" is a fact rather than whenever the suite happens to run.
private let denver = TimeZone(identifier: "America/Denver")!
private let fixedNow = Date(timeIntervalSince1970: 1_784_224_800)  // 2026-07-16T18:00:00Z, noon MDT

@MainActor
private func makeHome(
    api: FakeAPI = FakeAPI(),
    zone: TimeZone = denver
) -> (HomeViewModel, FakeAPI) {
    let model = HomeViewModel(
        api: api,
        dates: CabinDate(timeZone: zone, locale: Locale(identifier: "en_US")),
        now: { fixedNow }
    )
    return (model, api)
}

private func allDay(_ title: String, _ start: String, _ end: String) -> CalendarEvent {
    .fixture(title: title, startsAt: start, endsAt: end, isAllDay: true)
}

private func timed(_ title: String, _ start: String, _ end: String) -> CalendarEvent {
    .fixture(title: title, startsAt: start, endsAt: end, isAllDay: false)
}

@MainActor
struct UpcomingSelectionTests {
    @Test("the next three are chosen in chronological order")
    func picksNextThreeInOrder() async throws {
        let (home, api) = makeHome()
        await api.seed(events: [
            allDay("Fourth",  "2026-08-01", "2026-08-02"),
            allDay("First",   "2026-07-17", "2026-07-18"),
            allDay("Third",   "2026-07-25", "2026-07-26"),
            allDay("Second",  "2026-07-20", "2026-07-24"),
        ])

        await home.load()

        #expect(home.upcoming.map(\.title) == ["First", "Second", "Third"])
    }

    /// The window starts at the beginning of today, so an event that ended
    /// yesterday must be dropped by the filter rather than by the query.
    @Test("finished events are excluded")
    func excludesPastEvents() async throws {
        let (home, api) = makeHome()
        await api.seed(events: [
            allDay("Last week",  "2026-07-06", "2026-07-10"),
            allDay("Yesterday",  "2026-07-15", "2026-07-15"),
            allDay("Next week",  "2026-07-22", "2026-07-24"),
        ])

        await home.load()
        #expect(home.upcoming.map(\.title) == ["Next week"])
    }

    /// C25 at the boundary. A stay through today is still happening — it must
    /// not vanish from "upcoming" on its own last morning.
    @Test("an all-day event is still upcoming on its final day")
    func inclusiveEndStaysUpcoming() async throws {
        let (home, api) = makeHome()
        await api.seed(events: [
            allDay("Ends today", "2026-07-12", "2026-07-16"),
        ])

        await home.load()
        #expect(home.upcoming.map(\.title) == ["Ends today"])
    }

    @Test("an all-day event that ended yesterday is gone")
    func endedYesterdayDropped() async throws {
        let (home, api) = makeHome()
        await api.seed(events: [allDay("Ended", "2026-07-12", "2026-07-15")])
        await home.load()
        #expect(home.upcoming.isEmpty)
    }

    /// A timed event still running counts as upcoming; one that finished an
    /// hour ago does not.
    @Test("a timed event in progress is upcoming; a finished one is not")
    func timedInProgress() async throws {
        let (home, api) = makeHome()
        await api.seed(events: [
            timed("In progress", "2026-07-16T17:00:00.000Z", "2026-07-16T19:00:00.000Z"),
            timed("Just ended",  "2026-07-16T15:00:00.000Z", "2026-07-16T17:00:00.000Z"),
        ])

        await home.load()
        #expect(home.upcoming.map(\.title) == ["In progress"])
    }

    /// Matching the day detail, where multi-day and all-day events pin above
    /// the hour column.
    @Test("within a day, all-day events sort ahead of timed ones")
    func allDayFirstWithinADay() async throws {
        let (home, api) = makeHome()
        await api.seed(events: [
            timed("Afternoon", "2026-07-17T20:00:00.000Z", "2026-07-17T21:00:00.000Z"),
            allDay("All day",  "2026-07-17", "2026-07-17"),
            timed("Morning",   "2026-07-17T15:00:00.000Z", "2026-07-17T16:00:00.000Z"),
        ])

        await home.load()
        #expect(home.upcoming.map(\.title) == ["All day", "Morning", "Afternoon"])
    }

    @Test("no more than three are shown even when many are upcoming")
    func capsAtThree() async throws {
        let (home, api) = makeHome()
        await api.seed(events: (1...10).map {
            allDay("Event \($0)", "2026-07-2\($0 % 9)", "2026-07-2\($0 % 9)")
        })
        await home.load()
        #expect(home.upcoming.count == 3)
    }

    @Test("an empty calendar yields an empty section, not an error")
    func emptyCalendar() async throws {
        let (home, _) = makeHome()
        await home.load()
        #expect(home.upcoming.isEmpty)
        #expect(home.errorMessage == nil)
    }

    /// The selection is driven by date-only strings, so it must not change
    /// with the viewer's timezone.
    @Test("selection is identical at extreme timezones", arguments: [
        "Pacific/Pago_Pago", "Pacific/Apia", "America/Denver", "UTC",
    ])
    func zoneIndependentSelection(zone: String) async throws {
        let (home, api) = makeHome(zone: TimeZone(identifier: zone)!)
        await api.seed(events: [
            allDay("Second", "2026-07-20", "2026-07-24"),
            allDay("First",  "2026-07-17", "2026-07-18"),
        ])
        await home.load()
        #expect(home.upcoming.map(\.title) == ["First", "Second"])
    }

    @Test("an event with undecodable dates is skipped rather than half-rendered")
    func skipsUndecodableEvent() async throws {
        let (home, api) = makeHome()
        await api.seed(events: [
            timed("Broken", "not-a-date", "also-not"),
            allDay("Good",   "2026-07-20", "2026-07-21"),
        ])
        await home.load()
        #expect(home.upcoming.map(\.title) == ["Good"])
    }
}

@MainActor
struct HomeAnnouncementTests {
    @Test("the three most recent announcements are requested")
    func requestsThree() async throws {
        let (home, api) = makeHome()
        await api.seed(announcements: (1...5).map { .fixture(body: "Announcement \($0)") })

        await home.load()

        #expect(home.announcements.count == 5, "the fake returns what it holds")
        #expect(await api.callCount("listAnnouncements") == 1)
    }

    @Test("a failure in one section does not blank the other")
    func partialFailure() async throws {
        let (home, api) = makeHome()
        await api.seed(events: [allDay("Stay", "2026-07-20", "2026-07-24")])
        // Announcements are requested first, so this error hits that call.
        await api.setNextError(APIError(
            status: 500, code: "INTERNAL", message: "Something went wrong on the server."
        ))

        await home.load()

        #expect(home.announcements.isEmpty)
        #expect(home.upcoming.map(\.title) == ["Stay"], "the calendar still loaded")
        #expect(home.errorMessage == "Something went wrong on the server.")
    }

    @Test("a network failure surfaces an actionable message")
    func surfacesNetworkError() async throws {
        let (home, api) = makeHome()
        await api.setNextError(APIError(
            status: 0, code: "NETWORK_ERROR",
            message: "You appear to be offline. Check your connection and try again."
        ))
        await home.load()
        #expect(home.errorMessage?.contains("offline") == true)
    }

    @Test("a reload clears a stale error")
    func clearsStaleError() async throws {
        let (home, api) = makeHome()
        await api.setNextError(APIError(status: 500, code: "INTERNAL", message: "boom"))
        await home.load()
        #expect(home.errorMessage != nil)

        await home.load()
        #expect(home.errorMessage == nil)
    }
}

@MainActor
struct HomeFormattingTests {
    /// C27 — Home and the calendar must not disagree about what a range says.
    @Test("a multi-day all-day range reads through its last day")
    func multiDayLabel() async throws {
        let (home, _) = makeHome()
        let label = home.rangeLabel(for: allDay("Stay", "2026-07-16", "2026-07-20"))
        #expect(label.contains("Jul 16"))
        #expect(label.contains("Jul 20"))
    }

    @Test("a single-day all-day event shows one date")
    func singleDayLabel() async throws {
        let (home, _) = makeHome()
        let label = home.rangeLabel(for: allDay("Day", "2026-07-16", "2026-07-16"))
        #expect(label.contains("Jul 16"))
        #expect(label.contains("–") == false)
    }

    /// The all-day label must name the literal day in every zone — the naive
    /// implementation renders Jul 15 at negative offsets.
    @Test("an all-day label does not shift at UTC-11")
    func noShiftAtExtremeZone() async throws {
        let (home, _) = makeHome(zone: TimeZone(identifier: "Pacific/Pago_Pago")!)
        let label = home.rangeLabel(for: allDay("Stay", "2026-07-16", "2026-07-16"))
        #expect(label.contains("Jul 16"))
        #expect(label.contains("Jul 15") == false)
    }

    @Test("an announcement shows its posted date")
    func announcementDate() async throws {
        let (home, _) = makeHome()
        let label = home.dateLabel(for: .fixture())
        #expect(label.contains("2026"))
    }
}
