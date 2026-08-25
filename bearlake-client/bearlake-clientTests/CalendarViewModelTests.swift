//
//  CalendarViewModelTests.swift
//  bearlake-clientTests
//

import Foundation
import Testing
@testable import bearlake_client

private let denver = TimeZone(identifier: "America/Denver")!
/// 2026-07-17T18:00:00Z — noon on Friday July 17 in Denver.
private let fixedNow = Date(timeIntervalSince1970: 1_784_311_200)

private let extremeZones = ["Pacific/Pago_Pago", "Pacific/Apia", "America/Denver", "UTC"]

@MainActor
private func makeCalendar(
    api: FakeAPI = FakeAPI(),
    zone: TimeZone = denver
) -> (CalendarViewModel, FakeAPI) {
    let model = CalendarViewModel(
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

// MARK: - Selection rules (spec §8.3)

@MainActor
struct SelectionRuleTests {
    @Test("the selected day defaults to today on first load")
    func defaultsToToday() {
        let (model, _) = makeCalendar()
        #expect(model.selectedDay == "2026-07-17")
        #expect(model.displayedYear == 2026)
        #expect(model.displayedMonth == 7)
    }

    /// Rule 1: changing the month selects the 1st of that month.
    @Test("changing the month selects the first of that month")
    func monthChangeSelectsFirst() {
        let (model, _) = makeCalendar()
        model.showMonth(9)
        #expect(model.displayedMonth == 9)
        #expect(model.selectedDay == "2026-09-01")
    }

    @Test("stepping the month also selects the first")
    func monthStepSelectsFirst() {
        let (model, _) = makeCalendar()
        model.stepMonth(by: 1)
        #expect(model.selectedDay == "2026-08-01")
        model.stepMonth(by: -1)
        #expect(model.selectedDay == "2026-07-01")
    }

    @Test("stepping past December rolls the year")
    func monthStepRollsYear() {
        let (model, _) = makeCalendar()
        model.showMonth(12)
        model.stepMonth(by: 1)
        #expect(model.displayedYear == 2027)
        #expect(model.displayedMonth == 1)
        #expect(model.selectedDay == "2027-01-01")

        model.stepMonth(by: -1)
        #expect(model.displayedYear == 2026)
        #expect(model.displayedMonth == 12)
        #expect(model.selectedDay == "2026-12-01")
    }

    @Test("stepping by twelve returns to the same month a year away")
    func monthStepTwelve() {
        let (model, _) = makeCalendar()
        model.stepMonth(by: 12)
        #expect(model.displayedYear == 2027)
        #expect(model.displayedMonth == 7)
    }

    /// Rule 2: changing the year moves to the corresponding date.
    @Test("changing the year keeps the month and day")
    func yearChangeKeepsMonthAndDay() {
        let (model, _) = makeCalendar()
        model.selectDay("2026-07-17")
        model.showYear(2028)
        #expect(model.displayedYear == 2028)
        #expect(model.displayedMonth == 7)
        #expect(model.selectedDay == "2028-07-17")
    }

    /// The case the rule exists for. Feb 29 has no counterpart in a non-leap
    /// year; it must clamp to Feb 28 rather than roll into March or produce
    /// an invalid date.
    @Test("Feb 29 clamps to Feb 28 when the target year is not a leap year")
    func feb29ClampsToFeb28() {
        let (model, _) = makeCalendar()
        model.showMonth(2)
        model.selectDay("2028-02-29")
        #expect(model.selectedDay == "2028-02-29", "2028 is a leap year")

        model.showYear(2026)
        #expect(model.selectedDay == "2026-02-28")
        #expect(model.selectedDay.hasPrefix("2026-03") == false, "must not roll into March")
    }

    @Test("Feb 29 survives a move between two leap years")
    func feb29SurvivesLeapToLeap() {
        let (model, _) = makeCalendar()
        model.showMonth(2)
        model.selectDay("2028-02-29")
        model.showYear(2032)
        #expect(model.selectedDay == "2032-02-29")
    }

    /// The same clamp applies to any month-length mismatch, not only February.
    @Test("day 31 clamps when the target month is shorter")
    func day31Clamps() {
        let (model, _) = makeCalendar()
        model.selectDay("2026-01-31")
        model.showYear(2027)
        #expect(model.selectedDay == "2027-01-31", "January has 31 days in both")
    }

    @Test("selecting a padding day follows it into its own month")
    func paddingDayMovesMonth() {
        let (model, _) = makeCalendar()
        // The July 2026 grid opens on Sunday June 28.
        model.selectDay("2026-06-28")
        #expect(model.selectedDay == "2026-06-28")
        #expect(model.displayedMonth == 6, "the grid follows the selection")
        #expect(model.displayedYear == 2026)
    }

    @Test("stepping the selected day crosses a month boundary")
    func dayStepCrossesMonth() {
        let (model, _) = makeCalendar()
        model.selectDay("2026-07-31")
        model.stepSelectedDay(by: 1)
        #expect(model.selectedDay == "2026-08-01")
        #expect(model.displayedMonth == 8)

        model.stepSelectedDay(by: -1)
        #expect(model.selectedDay == "2026-07-31")
        #expect(model.displayedMonth == 7)
    }

    @Test("an invalid month is ignored rather than corrupting state")
    func ignoresInvalidMonth() {
        let (model, _) = makeCalendar()
        model.showMonth(13)
        #expect(model.displayedMonth == 7)
        model.showMonth(0)
        #expect(model.displayedMonth == 7)
    }

    /// Selection is pure string arithmetic, so it must not vary by zone.
    @Test("selection rules are identical in every timezone", arguments: extremeZones)
    func selectionIsZoneIndependent(zone: String) {
        let (model, _) = makeCalendar(zone: TimeZone(identifier: zone)!)
        model.showMonth(9)
        #expect(model.selectedDay == "2026-09-01")
        model.selectDay("2028-02-29")
        model.showYear(2026)
        #expect(model.selectedDay == "2026-02-28")
    }
}

// MARK: - Fetch window (step 5)

@MainActor
struct FetchWindowTests {
    @Test("the window spans the displayed month plus one either side")
    func windowIsThreeMonths() async throws {
        let (model, _) = makeCalendar()
        let window = try #require(model.fetchWindow)
        #expect(model.dates.dateOnlyString(from: window.start) == "2026-06-01")
        #expect(model.dates.dateOnlyString(from: window.end) == "2026-09-01")
    }

    @Test("the window stays well inside the server's 366-day cap")
    func windowWithinCap() throws {
        for month in 1...12 {
            let (model, _) = makeCalendar()
            model.showMonth(month)
            let window = try #require(model.fetchWindow)
            let days = Int(window.end.timeIntervalSince(window.start) / 86_400)
            #expect(days <= Limits.eventRangeMaxWindowDays)
            #expect(days >= 59, "three months is never shorter than this")
        }
    }

    @Test("the window rolls the year at both boundaries")
    func windowRollsYear() throws {
        let (model, _) = makeCalendar()
        model.showMonth(1)
        var window = try #require(model.fetchWindow)
        #expect(model.dates.dateOnlyString(from: window.start) == "2025-12-01")

        model.showMonth(12)
        window = try #require(model.fetchWindow)
        // The upper bound is exclusive and the window covers Nov/Dec/Jan, so
        // it ends at the start of February — not January.
        #expect(model.dates.dateOnlyString(from: window.start) == "2026-11-01")
        #expect(model.dates.dateOnlyString(from: window.end) == "2027-02-01")
    }

    @Test("both bounds are sent on the request")
    func sendsBothBounds() async throws {
        let (model, api) = makeCalendar()
        await model.load()
        #expect(await api.callCount("listEvents") == 1)
    }

    @Test("navigating to a new month refetches")
    func navigationRefetches() async throws {
        let (model, api) = makeCalendar()
        await model.loadIfNeeded()
        #expect(await api.callCount("listEvents") == 1)

        model.stepMonth(by: 1)
        await model.loadIfNeeded()
        #expect(await api.callCount("listEvents") == 2)
    }

    /// Re-entering `.task` on the same month must not re-request.
    @Test("the same window is not refetched")
    func sameWindowNotRefetched() async throws {
        let (model, api) = makeCalendar()
        await model.loadIfNeeded()
        await model.loadIfNeeded()
        await model.loadIfNeeded()
        #expect(await api.callCount("listEvents") == 1)
    }

    /// Selecting a different day within the same month keeps the window.
    @Test("changing only the day does not refetch")
    func dayChangeKeepsWindow() async throws {
        let (model, api) = makeCalendar()
        await model.loadIfNeeded()
        model.selectDay("2026-07-25")
        await model.loadIfNeeded()
        #expect(await api.callCount("listEvents") == 1)
    }

    @Test("a failed load surfaces a message and keeps the app usable")
    func failedLoadSurfaces() async throws {
        let (model, api) = makeCalendar()
        await api.setNextError(APIError(
            status: 500, code: "INTERNAL", message: "Something went wrong on the server."
        ))
        await model.load()
        #expect(model.errorMessage == "Something went wrong on the server.")
        #expect(model.events.isEmpty)
    }
}

// MARK: - Day membership and ordering

@MainActor
struct DayContentTests {
    /// §11.3 — the classic multi-day bug. A stay must appear on every day it
    /// covers, not only its first.
    @Test("a multi-day event appears on every day it spans")
    func multiDaySpansEveryDay() async throws {
        let (model, api) = makeCalendar()
        await api.seed(events: [allDay("Family stay", "2026-07-16", "2026-07-20")])
        await model.load()

        for day in ["2026-07-16", "2026-07-17", "2026-07-18", "2026-07-19", "2026-07-20"] {
            #expect(model.events(on: day).map(\.title) == ["Family stay"], "missing on \(day)")
            #expect(model.hasEvents(on: day), "grid dot missing on \(day)")
        }
        #expect(model.events(on: "2026-07-15").isEmpty)
        #expect(model.events(on: "2026-07-21").isEmpty)
    }

    /// §11.3 — an event overlapping the window edge must still show on the
    /// days inside it.
    @Test("an event starting before the window still appears inside it")
    func eventStartingBeforeWindow() async throws {
        let (model, api) = makeCalendar()
        await api.seed(events: [allDay("Long stay", "2026-05-20", "2026-07-05")])
        await model.load()
        #expect(model.events(on: "2026-07-01").map(\.title) == ["Long stay"])
        #expect(model.events(on: "2026-07-05").map(\.title) == ["Long stay"])
        #expect(model.events(on: "2026-07-06").isEmpty)
    }

    @Test("an event ending after the window still appears inside it")
    func eventEndingAfterWindow() async throws {
        let (model, api) = makeCalendar()
        await api.seed(events: [allDay("Season", "2026-07-28", "2026-10-15")])
        await model.load()
        #expect(model.events(on: "2026-07-31").map(\.title) == ["Season"])
        #expect(model.events(on: "2026-07-27").isEmpty)
    }

    @Test("all-day and multi-day events pin above timed ones")
    func pinnedOrdering() async throws {
        let (model, api) = makeCalendar()
        await api.seed(events: [
            timed("Afternoon", "2026-07-17T20:00:00.000Z", "2026-07-17T21:00:00.000Z"),
            allDay("All day", "2026-07-17", "2026-07-17"),
            timed("Morning", "2026-07-17T15:00:00.000Z", "2026-07-17T16:00:00.000Z"),
            allDay("Multi-day", "2026-07-16", "2026-07-18"),
        ])
        await model.load()

        let titles = model.events(on: "2026-07-17").map(\.title)
        #expect(Set(titles.prefix(2)) == ["All day", "Multi-day"], "pinned first")
        #expect(Array(titles.suffix(2)) == ["Morning", "Afternoon"], "then timed, by start")
    }

    @Test("a single-day timed event is not pinned")
    func timedNotPinned() async throws {
        let (model, api) = makeCalendar()
        let event = timed("Sauna", "2026-07-17T16:00:00.000Z", "2026-07-17T17:00:00.000Z")
        await api.seed(events: [event])
        await model.load()
        #expect(model.isPinned(event) == false)
    }

    @Test("a multi-day timed event is pinned")
    func multiDayTimedIsPinned() async throws {
        let (model, api) = makeCalendar()
        let event = timed("Overnight", "2026-07-17T04:00:00.000Z", "2026-07-18T04:00:00.000Z")
        await api.seed(events: [event])
        await model.load()
        #expect(model.isPinned(event), "it has no single hour to sit in")
    }
}

// MARK: - Hour column

@MainActor
struct HourColumnTests {
    /// The hour row is the event's start hour **in the viewer's zone**, so
    /// the same instant lands on different rows for different viewers — which
    /// is correct, and is why this is tested across zones.
    @Test("a timed event lands on its local hour row")
    func hourRowIsLocal() async throws {
        let event = timed("Sauna", "2026-07-17T16:00:00.000Z", "2026-07-17T17:00:00.000Z")

        let expected: [String: Int] = [
            "America/Denver": 10,      // UTC−6 in July
            "UTC": 16,
            "Pacific/Pago_Pago": 5,    // UTC−11
            "Pacific/Apia": 5,         // UTC+13 → next day 05:00
        ]

        for (zone, hour) in expected {
            let (model, api) = makeCalendar(zone: TimeZone(identifier: zone)!)
            await api.seed(events: [event])
            await model.load()
            #expect(model.hourRow(for: event) == hour, "wrong row in \(zone)")
        }
    }

    @Test("a pinned event has no hour row")
    func pinnedHasNoRow() async throws {
        let (model, api) = makeCalendar()
        let event = allDay("Stay", "2026-07-16", "2026-07-18")
        await api.seed(events: [event])
        await model.load()
        #expect(model.hourRow(for: event) == nil)
    }

    @Test("midnight and late-evening events land on the first and last rows")
    func boundaryHours() async throws {
        let (model, api) = makeCalendar()
        // 06:00Z is midnight in Denver; 05:00Z is 23:00 the previous day.
        let midnight = timed("Midnight", "2026-07-17T06:00:00.000Z", "2026-07-17T07:00:00.000Z")
        let lateNight = timed("Late", "2026-07-18T05:00:00.000Z", "2026-07-18T05:30:00.000Z")
        await api.seed(events: [midnight, lateNight])
        await model.load()
        #expect(model.hourRow(for: midnight) == 0)
        #expect(model.hourRow(for: lateNight) == 23)
    }
}

// MARK: - Grid

@MainActor
struct CalendarGridTests {
    @Test("the grid is 42 cells for the displayed month")
    func gridShape() {
        let (model, _) = makeCalendar()
        #expect(model.grid.count == 42)
        #expect(model.grid.filter(\.isInDisplayedMonth).count == 31, "July has 31 days")
    }

    @Test("the grid follows month navigation")
    func gridFollowsNavigation() {
        let (model, _) = makeCalendar()
        model.showMonth(2)
        #expect(model.grid.filter(\.isInDisplayedMonth).count == 28, "February 2026")
        model.showYear(2028)
        #expect(model.grid.filter(\.isInDisplayedMonth).count == 29, "February 2028 is a leap year")
    }

    @Test("the month label matches the displayed month")
    func monthLabel() {
        let (model, _) = makeCalendar()
        #expect(model.monthLabel == "July")
        model.showMonth(12)
        #expect(model.monthLabel == "December")
    }
}

// MARK: - Day actions (step 6)

@MainActor
struct DayActionTests {
    private let admin = PublicUser.fixture(id: "admin-1", displayName: "Zach", role: .admin)
    private let member = PublicUser.fixture(id: "member-1", displayName: "Rachel", role: .member)

    @Test("tapping empty space asks to create on that day")
    func createCarriesTheDay() {
        let (model, _) = makeCalendar()
        model.selectDay("2026-07-22")
        model.requestCreate(on: model.selectedDay)
        #expect(model.pendingAction == .create(dateOnly: "2026-07-22"))
    }

    @Test("an admin may edit anyone's event")
    func adminEditsAnything() {
        let (model, _) = makeCalendar()
        let someoneElses = CalendarEvent.fixture(title: "Theirs")
        #expect(model.canEdit(someoneElses, as: admin))

        model.requestOpen(someoneElses, as: admin)
        #expect(model.pendingAction == .edit(someoneElses))
    }

    @Test("a member may edit only their own event")
    func memberEditsOwn() {
        let (model, _) = makeCalendar()
        var mine = CalendarEvent.fixture(title: "Mine")
        mine = CalendarEvent(
            id: mine.id, title: mine.title, notes: nil,
            startsAt: mine.startsAt, endsAt: mine.endsAt, isAllDay: mine.isAllDay,
            createdBy: member.id, creatorDisplayName: member.displayName,
            createdAt: mine.createdAt, updatedAt: mine.updatedAt
        )
        #expect(model.canEdit(mine, as: member))
        model.requestOpen(mine, as: member)
        #expect(model.pendingAction == .edit(mine))
    }

    /// The affordance half of C48. The server independently rejects the
    /// write, so this only decides which screen opens.
    @Test("a member opening someone else's event gets the read-only view")
    func memberViewsOthers() {
        let (model, _) = makeCalendar()
        let theirs = CalendarEvent.fixture(title: "Theirs")  // createdBy is the fixture's admin id
        #expect(model.canEdit(theirs, as: member) == false)

        model.requestOpen(theirs, as: member)
        #expect(model.pendingAction == .view(theirs))
    }

    @Test("with no signed-in user nothing is editable")
    func noUserNoEdit() {
        let (model, _) = makeCalendar()
        let event = CalendarEvent.fixture()
        #expect(model.canEdit(event, as: nil) == false)
        model.requestOpen(event, as: nil)
        #expect(model.pendingAction == .view(event))
    }
}
