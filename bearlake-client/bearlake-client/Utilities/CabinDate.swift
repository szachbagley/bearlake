//
//  CabinDate.swift
//  bearlake-client
//
//  Every piece of calendar logic in the app (C27). Month-grid enumeration,
//  "which day does this event belong to", inclusive range labelling, and
//  date-only formatting live here and nowhere else — duplicating any of it
//  per view is how the two halves drift apart.
//
//  Wire parsing is deliberately NOT here; that is Models/DTOs/APICoding.swift.
//

import Foundation

/// Date logic, parameterised by calendar and timezone.
///
/// Nothing here reads `Calendar.current` or `TimeZone.current` implicitly
/// (C26) — a test that cannot pin the zone cannot prove anything about the
/// bugs this app is actually prone to.
struct CabinDate: Sendable {
    let calendar: Calendar

    /// - Parameter timeZone: the viewer's zone. iOS renders viewer-local
    ///   time; there is deliberately no cabin-time echo (C28).
    init(timeZone: TimeZone = .current, locale: Locale = .current) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        calendar.locale = locale
        // Sunday-start, matching the storyboard's month grid.
        calendar.firstWeekday = 1
        self.calendar = calendar
    }

    var timeZone: TimeZone { calendar.timeZone }

    // MARK: - Date-only strings (C22)

    /// Reads a `YYYY-MM-DD` string **without ever building a `Date` from the
    /// literal**. The components are parsed as text, so no timezone is
    /// applied to a value that has none.
    ///
    /// Returns nil for anything that is not a real calendar date, so
    /// `2026-02-30` fails visibly rather than silently rolling into March.
    func components(fromDateOnly value: String) -> DateComponents? {
        let parts = value.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3,
              parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2])
        else { return nil }

        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.calendar = calendar
        guard components.isValidDate else { return nil }
        return components
    }

    /// The `YYYY-MM-DD` string for an instant, in this instance's zone.
    func dateOnlyString(from date: Date) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return Self.dateOnlyString(
            year: parts.year ?? 0,
            month: parts.month ?? 0,
            day: parts.day ?? 0
        )
    }

    static func dateOnlyString(year: Int, month: Int, day: Int) -> String {
        String(format: "%04d-%02d-%02d", year, month, day)
    }

    func todayDateOnly(now: Date = Date()) -> String {
        dateOnlyString(from: now)
    }

    /// Adds days to a date-only string, staying in date-only space and using
    /// `DateComponents` arithmetic rather than `+ 86400` (C29).
    func dateOnly(_ value: String, addingDays days: Int) -> String? {
        guard let components = components(fromDateOnly: value),
              let anchor = calendar.date(from: components),
              let moved = calendar.date(byAdding: .day, value: days, to: anchor)
        else { return nil }
        return dateOnlyString(from: moved)
    }

    /// The number of days an inclusive all-day range spans. Jul 16–20 is
    /// **5 days**, not 4 (C25).
    func inclusiveDayCount(from start: String, to end: String) -> Int? {
        guard let startComponents = components(fromDateOnly: start),
              let endComponents = components(fromDateOnly: end),
              let startDate = calendar.date(from: startComponents),
              let endDate = calendar.date(from: endComponents),
              let difference = calendar.dateComponents([.day], from: startDate, to: endDate).day
        else { return nil }
        return difference + 1
    }

    // MARK: - Display

    /// Labels an event's dates for the day detail and event views.
    ///
    /// All-day ranges read as *through* the last day, because the end is
    /// inclusive (C25) — writing "until Jul 20" for a stay that includes
    /// Jul 20 is the classic off-by-one this app must not ship.
    func rangeLabel(for dates: EventDates) -> String {
        switch dates {
        case .allDay(let start, let end):
            guard let startComponents = components(fromDateOnly: start),
                  let startDate = calendar.date(from: startComponents)
            else { return start }

            if start == end {
                return dayFormatter.string(from: startDate)
            }
            guard let endComponents = components(fromDateOnly: end),
                  let endDate = calendar.date(from: endComponents)
            else { return start }
            return "\(dayFormatter.string(from: startDate)) – \(dayFormatter.string(from: endDate))"

        case .timed(let start, let end):
            if calendar.isDate(start, inSameDayAs: end) {
                return "\(dayFormatter.string(from: start)), "
                    + "\(timeFormatter.string(from: start)) – \(timeFormatter.string(from: end))"
            }
            return "\(dayTimeFormatter.string(from: start)) – \(dayTimeFormatter.string(from: end))"
        }
    }

    private var dayFormatter: DateFormatter {
        formatter(dateStyle: .medium, timeStyle: .none)
    }

    private var timeFormatter: DateFormatter {
        formatter(dateStyle: .none, timeStyle: .short)
    }

    private var dayTimeFormatter: DateFormatter {
        formatter(dateStyle: .medium, timeStyle: .short)
    }

    private func formatter(
        dateStyle: DateFormatter.Style,
        timeStyle: DateFormatter.Style
    ) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = calendar.locale ?? .current
        formatter.dateStyle = dateStyle
        formatter.timeStyle = timeStyle
        return formatter
    }

    // MARK: - Month grid

    /// One cell of the month grid.
    struct GridDay: Equatable, Identifiable, Sendable {
        /// `YYYY-MM-DD`, the identity used for selection and event matching.
        let dateOnly: String
        /// False for the leading and trailing days borrowed from the
        /// neighbouring months.
        let isInDisplayedMonth: Bool

        var id: String { dateOnly }
    }

    /// The 6×7 grid for a month, Sunday-start, including padding days from
    /// the neighbouring months.
    ///
    /// Always 42 cells so the grid does not change height between months — a
    /// shifting layout is more jarring than a mostly-empty final row.
    func monthGrid(year: Int, month: Int) -> [GridDay] {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = 1
        guard let firstOfMonth = calendar.date(from: components) else { return [] }

        let weekday = calendar.component(.weekday, from: firstOfMonth)
        let leading = weekday - calendar.firstWeekday
        let offset = leading < 0 ? leading + 7 : leading

        guard let gridStart = calendar.date(byAdding: .day, value: -offset, to: firstOfMonth) else {
            return []
        }

        return (0..<42).compactMap { index in
            guard let day = calendar.date(byAdding: .day, value: index, to: gridStart) else {
                return nil
            }
            let parts = calendar.dateComponents([.year, .month], from: day)
            return GridDay(
                dateOnly: dateOnlyString(from: day),
                isInDisplayedMonth: parts.year == year && parts.month == month
            )
        }
    }

    // MARK: - Day membership

    /// Whether an event belongs on a given day of the grid.
    ///
    /// The one place this question is answered. All-day events compare as
    /// strings against inclusive bounds; timed events are converted to
    /// date-only strings in the viewer's zone first, so the comparison
    /// happens entirely in date-only space either way.
    func event(_ dates: EventDates, fallsOn day: String) -> Bool {
        switch dates {
        case .allDay(let start, let end):
            return day >= start && day <= end
        case .timed(let start, let end):
            let startDay = dateOnlyString(from: start)
            var endDay = dateOnlyString(from: end)
            // A timed range's end is exclusive. An event finishing exactly at
            // midnight belongs to the day before, not to the one it merely
            // touches.
            if endDay > startDay, calendar.startOfDay(for: end) == end {
                endDay = dateOnly(endDay, addingDays: -1) ?? endDay
            }
            return day >= startDay && day <= endDay
        }
    }

    // MARK: - Month arithmetic

    /// The first instant of a month, for building fetch windows.
    func startOfMonth(year: Int, month: Int) -> Date? {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = 1
        return calendar.date(from: components)
    }

    /// How many days a month has. Used to clamp a day when moving between
    /// months or years — Jan 31 has no counterpart in February.
    func dayCount(year: Int, month: Int) -> Int? {
        guard let start = startOfMonth(year: year, month: month) else { return nil }
        return calendar.range(of: .day, in: .month, for: start)?.count
    }

    /// Splits a `YYYY-MM-DD` string into its parts, or nil if it is not a real
    /// date. Wraps `components(fromDateOnly:)` for the common case.
    func parts(ofDateOnly value: String) -> (year: Int, month: Int, day: Int)? {
        guard let components = components(fromDateOnly: value),
              let year = components.year,
              let month = components.month,
              let day = components.day
        else { return nil }
        return (year, month, day)
    }

    /// Builds a date-only string, clamping the day to the target month's
    /// length. Moving from 2028-02-29 to 2026 lands on 2026-02-28, not on
    /// an invalid date or silently on March 1.
    func dateOnly(year: Int, month: Int, clampingDay day: Int) -> String? {
        guard let count = dayCount(year: year, month: month) else { return nil }
        return Self.dateOnlyString(year: year, month: month, day: min(day, count))
    }

    // MARK: - Upcoming

    /// Whether an event is finished as of `now`.
    ///
    /// An all-day event is still current **on** its last day, because the end
    /// is inclusive (C25) — a stay through Jul 20 should not vanish from
    /// "upcoming" on the morning of Jul 20.
    func hasEnded(_ dates: EventDates, asOf now: Date) -> Bool {
        switch dates {
        case .allDay(_, let end):
            return end < todayDateOnly(now: now)
        case .timed(_, let end):
            return end <= now
        }
    }

    /// Ordering key for "what happens next".
    ///
    /// The day comes first as a **string**, so an all-day event is never
    /// routed through `Date` to be sorted (C22). Within a day, all-day events
    /// sort ahead of timed ones — matching how the day detail pins them to
    /// the top — and timed events then order by their instant.
    func upcomingSortKey(for dates: EventDates) -> (day: String, kind: Int, instant: TimeInterval) {
        switch dates {
        case .allDay(let start, _):
            return (start, 0, 0)
        case .timed(let start, _):
            return (dateOnlyString(from: start), 1, start.timeIntervalSince1970)
        }
    }

    /// A plain date label, for announcement timestamps.
    func dateLabel(from date: Date) -> String {
        formatter(dateStyle: .medium, timeStyle: .none).string(from: date)
    }

    /// Multi-day and all-day events pin to the top of the day detail; timed
    /// single-day events fall into the hour column below.
    func spansMultipleDays(_ dates: EventDates) -> Bool {
        switch dates {
        case .allDay(let start, let end):
            return start != end
        case .timed(let start, let end):
            return dateOnlyString(from: start) != dateOnlyString(from: end)
        }
    }
}
