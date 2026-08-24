//
//  CalendarViewModel.swift
//  bearlake-client
//

import Foundation
import Observation

@MainActor
@Observable
final class CalendarViewModel {
    /// The month on screen.
    private(set) var displayedYear: Int
    private(set) var displayedMonth: Int
    /// `YYYY-MM-DD`. Never a `Date` (C22).
    private(set) var selectedDay: String

    private(set) var events: [CalendarEvent] = []
    private(set) var isLoading = false
    var errorMessage: String?

    /// The window currently held, so navigation does not refetch a month it
    /// already has.
    private(set) var loadedWindow: (start: String, end: String)?

    let dates: CabinDate
    private let api: BearLakeAPI
    private let now: () -> Date

    init(api: BearLakeAPI, dates: CabinDate = CabinDate(), now: @escaping () -> Date = Date.init) {
        self.api = api
        self.dates = dates
        self.now = now

        // Selection defaults to today on first load (spec §8.3).
        let today = dates.todayDateOnly(now: now())
        self.selectedDay = today
        let parts = dates.parts(ofDateOnly: today)
        self.displayedYear = parts?.year ?? 2026
        self.displayedMonth = parts?.month ?? 1
    }

    var todayDateOnly: String { dates.todayDateOnly(now: now()) }

    var grid: [CabinDate.GridDay] {
        dates.monthGrid(year: displayedYear, month: displayedMonth)
    }

    // MARK: - Selection rules (spec §8.3)
    //
    // These three rules are quoted from the storyboard and are exact. They
    // look arbitrary until you use the screen: the point is that the selected
    // day is always visible in the grid you are looking at, so navigating
    // never leaves the detail pane showing a day from another month.

    /// Changing the **month** selects the **1st** of that month.
    func showMonth(_ month: Int) {
        guard (1...12).contains(month) else { return }
        displayedMonth = month
        selectedDay = CabinDate.dateOnlyString(year: displayedYear, month: month, day: 1)
    }

    /// Steps one month, rolling the year at the boundaries. Also selects the
    /// 1st, since it is a month change.
    func stepMonth(by delta: Int) {
        var month = displayedMonth + delta
        var year = displayedYear
        while month > 12 { month -= 12; year += 1 }
        while month < 1 { month += 12; year -= 1 }
        displayedYear = year
        displayedMonth = month
        selectedDay = CabinDate.dateOnlyString(year: year, month: month, day: 1)
    }

    /// Changing the **year** keeps the month and day, moving to the
    /// corresponding date in the new year.
    ///
    /// Feb 29 has no counterpart in a non-leap year, so the day is clamped to
    /// the month's length rather than rolling into March.
    func showYear(_ year: Int) {
        let day = dates.parts(ofDateOnly: selectedDay)?.day ?? 1
        displayedYear = year
        selectedDay = dates.dateOnly(year: year, month: displayedMonth, clampingDay: day)
            ?? CabinDate.dateOnlyString(year: year, month: displayedMonth, day: 1)
    }

    /// Tapping a day in the grid. A padding day from a neighbouring month
    /// also moves the displayed month, so the selection stays visible.
    func selectDay(_ dateOnly: String) {
        guard let parts = dates.parts(ofDateOnly: dateOnly) else { return }
        selectedDay = dateOnly
        if parts.year != displayedYear || parts.month != displayedMonth {
            displayedYear = parts.year
            displayedMonth = parts.month
        }
    }

    /// Steps the selected day by one, used by the day-detail chevrons.
    /// Follows the day into an adjacent month.
    func stepSelectedDay(by delta: Int) {
        guard let moved = dates.dateOnly(selectedDay, addingDays: delta) else { return }
        selectDay(moved)
    }

    // MARK: - Fetching

    /// The window to request: the displayed month **± 1 month**.
    ///
    /// A buffer month either side means the grid's leading and trailing
    /// padding days show their events too, and stepping one month is usually
    /// already covered. Three months is far inside the server's 366-day cap.
    var fetchWindow: (start: Date, end: Date)? {
        var previousMonth = displayedMonth - 1
        var previousYear = displayedYear
        if previousMonth < 1 { previousMonth = 12; previousYear -= 1 }

        var followingMonth = displayedMonth + 2  // exclusive upper bound
        var followingYear = displayedYear
        while followingMonth > 12 { followingMonth -= 12; followingYear += 1 }

        guard let start = dates.startOfMonth(year: previousYear, month: previousMonth),
              let end = dates.startOfMonth(year: followingYear, month: followingMonth)
        else { return nil }
        return (start, end)
    }

    func loadIfNeeded() async {
        guard let window = fetchWindow else { return }
        let key = (
            start: dates.dateOnlyString(from: window.start),
            end: dates.dateOnlyString(from: window.end)
        )
        if let loaded = loadedWindow, loaded == key { return }
        await load()
    }

    func load() async {
        guard isLoading == false, let window = fetchWindow else { return }
        isLoading = true
        defer { isLoading = false }

        do {
            events = try await api.listEvents(start: window.start, end: window.end)
            loadedWindow = (
                dates.dateOnlyString(from: window.start),
                dates.dateOnlyString(from: window.end)
            )
            errorMessage = nil
        } catch let error as APIError {
            errorMessage = error.message
        } catch {
            errorMessage = "Couldn't load the calendar."
        }
    }

    // MARK: - Day queries

    /// Every event falling on a day, ordered the way the detail pane shows
    /// them: all-day and multi-day first, then timed events by start.
    func events(on dateOnly: String) -> [CalendarEvent] {
        events
            .compactMap { event -> (CalendarEvent, EventDates)? in
                guard let parsed = event.dates else { return nil }
                return (event, parsed)
            }
            .filter { dates.event($0.1, fallsOn: dateOnly) }
            .sorted { left, right in
                let leftPinned = isPinned(left.1)
                let rightPinned = isPinned(right.1)
                if leftPinned != rightPinned { return leftPinned }
                let a = dates.upcomingSortKey(for: left.1)
                let b = dates.upcomingSortKey(for: right.1)
                if a.kind != b.kind { return a.kind < b.kind }
                return a.instant < b.instant
            }
            .map(\.0)
    }

    /// Whether the grid should mark a day as having something on it.
    func hasEvents(on dateOnly: String) -> Bool {
        events.contains { event in
            guard let parsed = event.dates else { return false }
            return dates.event(parsed, fallsOn: dateOnly)
        }
    }

    /// All-day events and anything spanning more than one day pin above the
    /// hour column — an event with no time, or one that covers the whole day,
    /// has no single hour to sit in.
    func isPinned(_ eventDates: EventDates) -> Bool {
        eventDates.isAllDay || dates.spansMultipleDays(eventDates)
    }

    func isPinned(_ event: CalendarEvent) -> Bool {
        guard let parsed = event.dates else { return false }
        return isPinned(parsed)
    }

    /// The hour row (0–23) a timed event belongs in, in the viewer's zone.
    /// Nil for pinned events, which are not in the column at all.
    func hourRow(for event: CalendarEvent) -> Int? {
        guard let parsed = event.dates, isPinned(parsed) == false,
              case .timed(let start, _) = parsed
        else { return nil }
        return dates.calendar.component(.hour, from: start)
    }

    // MARK: - Labels

    var monthLabel: String {
        let symbols = DateFormatter()
        symbols.calendar = dates.calendar
        symbols.locale = dates.calendar.locale ?? .current
        let names = symbols.standaloneMonthSymbols ?? []
        guard displayedMonth >= 1, displayedMonth <= names.count else { return "" }
        return names[displayedMonth - 1]
    }

    var selectedDayLabel: String {
        guard let components = dates.components(fromDateOnly: selectedDay),
              let date = dates.calendar.date(from: components)
        else { return selectedDay }
        return dates.dateLabel(from: date)
    }

    func rangeLabel(for event: CalendarEvent) -> String {
        guard let parsed = event.dates else { return "" }
        return dates.rangeLabel(for: parsed)
    }
}
