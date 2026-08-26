//
//  CabinDateTests.swift
//  bearlake-clientTests
//

import Foundation
import Testing
@testable import bearlake_client

/// The zones that actually break things. UTC−11 and UTC+13 are the extremes
/// of the offset range, so a value that survives both survives everything in
/// between; Denver is where the cabin is and is the one that matters most.
private let extremeZones: [String] = [
    "Pacific/Pago_Pago",   // UTC−11
    "Pacific/Apia",        // UTC+13
    "America/Denver",      // the cabin
    "UTC",
]

private func cabin(_ zone: String) throws -> CabinDate {
    CabinDate(
        timeZone: try #require(TimeZone(identifier: zone)),
        locale: Locale(identifier: "en_US")
    )
}

struct DateOnlyTests {
    /// The single most important assertion in the app: a date-only value must
    /// read back as itself in every timezone. The naive implementation
    /// (`ISO8601DateFormatter` on a bare date) fails this at UTC−11.
    @Test("a date-only string never shifts a day, in any zone", arguments: extremeZones)
    func neverShifts(zone: String) throws {
        let dates = try cabin(zone)
        for literal in ["2026-01-01", "2026-07-16", "2026-12-31", "2026-03-08", "2026-11-01"] {
            let components = try #require(dates.components(fromDateOnly: literal))
            #expect(components.year == Int(literal.prefix(4)))
            #expect(CabinDate.dateOnlyString(
                year: components.year ?? 0,
                month: components.month ?? 0,
                day: components.day ?? 0
            ) == literal)
        }
    }

    /// Round-tripping through the calendar must also be stable — this is the
    /// path `addingDays` and `inclusiveDayCount` take internally.
    @Test("a date-only string survives a calendar round trip", arguments: extremeZones)
    func survivesCalendarRoundTrip(zone: String) throws {
        let dates = try cabin(zone)
        for literal in ["2026-01-01", "2026-06-30", "2026-12-31"] {
            let components = try #require(dates.components(fromDateOnly: literal))
            let date = try #require(dates.calendar.date(from: components))
            #expect(dates.dateOnlyString(from: date) == literal)
        }
    }

    @Test("an impossible date is rejected rather than rolled forward")
    func rejectsImpossibleDates() throws {
        let dates = try cabin("America/Denver")
        #expect(dates.components(fromDateOnly: "2026-02-30") == nil)
        #expect(dates.components(fromDateOnly: "2026-13-01") == nil)
        #expect(dates.components(fromDateOnly: "2026-00-10") == nil)
        #expect(dates.components(fromDateOnly: "not-a-date") == nil)
        #expect(dates.components(fromDateOnly: "2026-1-1") == nil)
        #expect(dates.components(fromDateOnly: "") == nil)
    }

    @Test("2028 is a leap year and 2026 is not")
    func leapYears() throws {
        let dates = try cabin("America/Denver")
        #expect(dates.components(fromDateOnly: "2028-02-29") != nil)
        #expect(dates.components(fromDateOnly: "2026-02-29") == nil)
    }

    /// C29 — the reason date arithmetic never uses `+ 86400`. Both 2026 US
    /// transitions have a 23- and a 25-hour day; adding a fixed number of
    /// seconds lands on the wrong date.
    @Test("adding days crosses both DST transitions correctly")
    func addingDaysAcrossDST() throws {
        let dates = try cabin("America/Denver")
        // Spring forward: Mar 8 2026 is 23 hours long.
        #expect(dates.dateOnly("2026-03-07", addingDays: 1) == "2026-03-08")
        #expect(dates.dateOnly("2026-03-08", addingDays: 1) == "2026-03-09")
        // Fall back: Nov 1 2026 is 25 hours long.
        #expect(dates.dateOnly("2026-10-31", addingDays: 1) == "2026-11-01")
        #expect(dates.dateOnly("2026-11-01", addingDays: 1) == "2026-11-02")
        // Month and year boundaries.
        #expect(dates.dateOnly("2026-01-31", addingDays: 1) == "2026-02-01")
        #expect(dates.dateOnly("2026-12-31", addingDays: 1) == "2027-01-01")
        #expect(dates.dateOnly("2026-01-01", addingDays: -1) == "2025-12-31")
    }

    /// C25 — Jul 16–20 is a five-day stay. Off-by-one here is the classic
    /// multi-day bug.
    @Test("an inclusive range counts both endpoints", arguments: extremeZones)
    func inclusiveDayCount(zone: String) throws {
        let dates = try cabin(zone)
        #expect(dates.inclusiveDayCount(from: "2026-07-16", to: "2026-07-20") == 5)
        #expect(dates.inclusiveDayCount(from: "2026-07-16", to: "2026-07-16") == 1)
        // Across both DST transitions, where a seconds-based count would drift.
        #expect(dates.inclusiveDayCount(from: "2026-03-07", to: "2026-03-09") == 3)
        #expect(dates.inclusiveDayCount(from: "2026-10-31", to: "2026-11-02") == 3)
    }
}

struct RangeLabelTests {
    /// C25 again, at the display layer: the label must not say "until".
    @Test("a multi-day all-day range labels both endpoints")
    func allDayRangeLabel() throws {
        let dates = try cabin("America/Denver")
        let label = dates.rangeLabel(for: .allDay(start: "2026-07-16", end: "2026-07-20"))
        #expect(label.contains("Jul 16"))
        #expect(label.contains("Jul 20"))
        #expect(label.contains("2026"))
    }

    @Test("a single-day all-day event shows one date, not a range")
    func singleDayAllDayLabel() throws {
        let dates = try cabin("America/Denver")
        let label = dates.rangeLabel(for: .allDay(start: "2026-07-16", end: "2026-07-16"))
        #expect(label.contains("Jul 16"))
        #expect(label.contains("–") == false)
    }

    /// The label is rendered from the literal, so it must name July 16 even
    /// in the zone where the naive implementation would say July 15.
    @Test("an all-day label names the right day at UTC-11")
    func allDayLabelAtExtremeZone() throws {
        let dates = try cabin("Pacific/Pago_Pago")
        let label = dates.rangeLabel(for: .allDay(start: "2026-07-16", end: "2026-07-16"))
        #expect(label.contains("Jul 16"))
        #expect(label.contains("Jul 15") == false)
    }

    @Test("a same-day timed event shows one date and two times")
    func timedSameDayLabel() throws {
        let dates = try cabin("America/Denver")
        let start = try #require(APICoding.date(fromISO: "2026-07-16T18:00:00.000Z"))
        let end = try #require(APICoding.date(fromISO: "2026-07-16T21:00:00.000Z"))
        let label = dates.rangeLabel(for: .timed(start: start, end: end))
        // 18:00Z is noon in Denver (MDT, UTC−6).
        #expect(label.contains("Jul 16"))
        #expect(label.contains("12:00"))
        #expect(label.contains("3:00"))
    }
}

struct MonthGridTests {
    @Test("the grid is always 42 cells, Sunday-start", arguments: extremeZones)
    func gridShape(zone: String) throws {
        let dates = try cabin(zone)
        for month in 1...12 {
            let grid = dates.monthGrid(year: 2026, month: month)
            #expect(grid.count == 42)
            #expect(Set(grid.map(\.dateOnly)).count == 42, "grid days must be distinct")
        }
    }

    /// The grid is built from date-only strings, so it must be byte-identical
    /// regardless of the viewer's zone — a grid that differs by zone would
    /// put an event on different squares for different family members.
    @Test("the grid is identical in every timezone")
    func gridIsZoneIndependent() throws {
        let reference = try cabin("UTC").monthGrid(year: 2026, month: 7)
        for zone in extremeZones {
            #expect(try cabin(zone).monthGrid(year: 2026, month: 7) == reference)
        }
    }

    @Test("July 2026 starts on the correct weekday with correct padding")
    func julyGrid() throws {
        let dates = try cabin("America/Denver")
        let grid = dates.monthGrid(year: 2026, month: 7)
        // July 1 2026 is a Wednesday, so the grid opens on Sunday June 28.
        #expect(grid.first?.dateOnly == "2026-06-28")
        #expect(grid.first?.isInDisplayedMonth == false)
        #expect(grid[3].dateOnly == "2026-07-01")
        #expect(grid[3].isInDisplayedMonth == true)
        #expect(grid.filter(\.isInDisplayedMonth).count == 31)
        #expect(grid.last?.isInDisplayedMonth == false)
    }

    @Test("February 2026 has 28 in-month days")
    func februaryGrid() throws {
        let dates = try cabin("America/Denver")
        let grid = dates.monthGrid(year: 2026, month: 2)
        #expect(grid.filter(\.isInDisplayedMonth).count == 28)
    }

    /// A month that begins on Sunday is the case where a naive offset
    /// calculation produces a full blank leading week or a negative index.
    @Test("a month starting on Sunday has no leading padding")
    func monthStartingSunday() throws {
        let dates = try cabin("America/Denver")
        // Feb 1 2026 is a Sunday.
        let grid = dates.monthGrid(year: 2026, month: 2)
        #expect(grid.first?.dateOnly == "2026-02-01")
        #expect(grid.first?.isInDisplayedMonth == true)
    }

    /// The grid spans a DST transition in March and November; every cell must
    /// still be one calendar day apart.
    @Test("grid days stay consecutive across DST months")
    func gridAcrossDST() throws {
        let dates = try cabin("America/Denver")
        for month in [3, 11] {
            let grid = dates.monthGrid(year: 2026, month: month)
            for index in 1..<grid.count {
                let previous = grid[index - 1].dateOnly
                #expect(dates.dateOnly(previous, addingDays: 1) == grid[index].dateOnly)
            }
        }
    }

    @Test("December rolls into the next year")
    func decemberGrid() throws {
        let dates = try cabin("America/Denver")
        let grid = dates.monthGrid(year: 2026, month: 12)
        #expect(grid.contains { $0.dateOnly.hasPrefix("2027-01") })
        #expect(grid.filter(\.isInDisplayedMonth).count == 31)
    }
}

struct DayMembershipTests {
    @Test("an all-day event covers every day of its inclusive range")
    func allDayMembership() throws {
        let dates = try cabin("America/Denver")
        let stay = EventDates.allDay(start: "2026-07-16", end: "2026-07-20")
        #expect(dates.event(stay, fallsOn: "2026-07-15") == false)
        for day in ["2026-07-16", "2026-07-17", "2026-07-18", "2026-07-19", "2026-07-20"] {
            #expect(dates.event(stay, fallsOn: day), "\(day) should be inside the stay")
        }
        #expect(dates.event(stay, fallsOn: "2026-07-21") == false)
    }

    /// The inclusive-end rule at the boundary — the last day must be a member.
    @Test("the final day of an all-day range is included")
    func inclusiveEndIsMember() throws {
        let dates = try cabin("America/Denver")
        #expect(dates.event(.allDay(start: "2026-07-16", end: "2026-07-20"), fallsOn: "2026-07-20"))
    }

    @Test("all-day membership is identical in every timezone", arguments: extremeZones)
    func allDayMembershipIsZoneIndependent(zone: String) throws {
        let dates = try cabin(zone)
        let stay = EventDates.allDay(start: "2026-07-16", end: "2026-07-20")
        #expect(dates.event(stay, fallsOn: "2026-07-16"))
        #expect(dates.event(stay, fallsOn: "2026-07-20"))
        #expect(dates.event(stay, fallsOn: "2026-07-21") == false)
    }

    @Test("a timed event lands on its local day")
    func timedMembership() throws {
        let dates = try cabin("America/Denver")
        // 02:00Z on Jul 17 is 20:00 on Jul 16 in Denver.
        let start = try #require(APICoding.date(fromISO: "2026-07-17T02:00:00.000Z"))
        let end = try #require(APICoding.date(fromISO: "2026-07-17T04:00:00.000Z"))
        let evening = EventDates.timed(start: start, end: end)
        #expect(dates.event(evening, fallsOn: "2026-07-16"))
        #expect(dates.event(evening, fallsOn: "2026-07-17") == false)
    }

    /// A timed range's end is exclusive: an event ending exactly at midnight
    /// belongs to the day before, not the one it merely touches.
    @Test("an event ending at midnight does not claim the next day")
    func exclusiveTimedEnd() throws {
        let dates = try cabin("America/Denver")
        let start = try #require(APICoding.date(fromISO: "2026-07-16T20:00:00.000Z"))  // 14:00 MDT
        let end = try #require(APICoding.date(fromISO: "2026-07-17T06:00:00.000Z"))    // 00:00 MDT Jul 17
        let evening = EventDates.timed(start: start, end: end)
        #expect(dates.event(evening, fallsOn: "2026-07-16"))
        #expect(dates.event(evening, fallsOn: "2026-07-17") == false)
    }

    @Test("multi-day detection distinguishes the two shapes")
    func multiDayDetection() throws {
        let dates = try cabin("America/Denver")
        #expect(dates.spansMultipleDays(.allDay(start: "2026-07-16", end: "2026-07-20")))
        #expect(dates.spansMultipleDays(.allDay(start: "2026-07-16", end: "2026-07-16")) == false)

        let start = try #require(APICoding.date(fromISO: "2026-07-16T18:00:00.000Z"))
        let end = try #require(APICoding.date(fromISO: "2026-07-16T21:00:00.000Z"))
        #expect(dates.spansMultipleDays(.timed(start: start, end: end)) == false)
    }
}

// MARK: - Spoken day labels (Phase 11, step 3)

struct SpokenDayLabelTests {
    private func denver() throws -> CabinDate {
        CabinDate(timeZone: try #require(TimeZone(identifier: "America/Denver")),
                  locale: Locale(identifier: "en_US"))
    }

    /// The grid's visible cells are bare numbers, which is right on screen.
    /// VoiceOver reads them in isolation, so the label carries the weekday
    /// and month the header supplies visually.
    @Test("a grid day speaks its weekday and month, not just a number")
    func speaksFullDate() throws {
        let label = try denver().spokenDayLabel(forDateOnly: "2026-08-01")
        #expect(label.contains("Saturday"), "2026-08-01 is a Saturday")
        #expect(label.contains("August"))
        #expect(label.contains("1"))
    }

    /// C22, the bug this project is most prone to. A date-only string must
    /// never be read as UTC midnight — that renders a day early for every
    /// negative-offset viewer, Utah included.
    @Test("the spoken date does not shift by timezone", arguments: [
        "America/Denver", "America/New_York", "UTC", "Asia/Tokyo", "Pacific/Kiritimati",
    ])
    func doesNotShift(zone: String) throws {
        let dates = CabinDate(
            timeZone: try #require(TimeZone(identifier: zone)),
            locale: Locale(identifier: "en_US")
        )
        let label = dates.spokenDayLabel(forDateOnly: "2026-08-01")
        #expect(label.contains("Saturday"), "\(zone) must not shift the weekday")
        #expect(label.contains("August"), "\(zone) must not shift the month")
    }

    /// A malformed value must be visible, not silently turned into some
    /// other real date.
    @Test("a malformed date-only string falls back to itself")
    func malformedFallsBack() throws {
        let dates = try denver()
        #expect(dates.spokenDayLabel(forDateOnly: "2026-02-30") == "2026-02-30")
        #expect(dates.spokenDayLabel(forDateOnly: "nonsense") == "nonsense")
    }

    /// The turn of the year is where an off-by-one is most visible.
    @Test("New Year's Day speaks correctly")
    func newYear() throws {
        let label = try denver().spokenDayLabel(forDateOnly: "2027-01-01")
        #expect(label.contains("January"))
        #expect(label.contains("Friday"), "2027-01-01 is a Friday")
    }
}
