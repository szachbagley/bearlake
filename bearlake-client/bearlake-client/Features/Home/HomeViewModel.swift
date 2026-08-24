//
//  HomeViewModel.swift
//  bearlake-client
//

import Foundation
import Observation

@MainActor
@Observable
final class HomeViewModel {
    /// How many announcements the Home screen shows before the "Older
    /// announcements" link. Neither the spec nor the storyboard fixes a
    /// number — the storyboard shows two, which is simply what fit the
    /// wireframe. Three mirrors the "next three" events beside it (C51).
    static let announcementPreviewCount = 3
    static let upcomingEventCount = 3

    private(set) var announcements: [Announcement] = []
    private(set) var upcoming: [CalendarEvent] = []
    private(set) var isLoading = false
    /// Bound to an `.alert`. Every network failure surfaces something the
    /// user can act on; nothing fails silently.
    var errorMessage: String?

    private let api: BearLakeAPI
    private let dates: CabinDate
    private let now: () -> Date

    init(api: BearLakeAPI, dates: CabinDate = CabinDate(), now: @escaping () -> Date = Date.init) {
        self.api = api
        self.dates = dates
        self.now = now
    }

    var isEmpty: Bool { announcements.isEmpty && upcoming.isEmpty }

    func load() async {
        guard isLoading == false else { return }
        isLoading = true
        defer { isLoading = false }

        // Both sections are independent; one failing should not blank the
        // other, so they are awaited separately and the first error wins the
        // alert.
        var firstError: String?

        do {
            let page = try await api.listAnnouncements(
                limit: Self.announcementPreviewCount, cursor: nil
            )
            announcements = page.items
        } catch let error as APIError {
            firstError = error.message
        } catch {
            firstError = "Couldn't load announcements."
        }

        do {
            upcoming = try await loadUpcoming()
        } catch let error as APIError {
            firstError = firstError ?? error.message
        } catch {
            firstError = firstError ?? "Couldn't load the calendar."
        }

        errorMessage = firstError
    }

    /// The next three events.
    ///
    /// `GET /events` requires a bounded window and refuses anything wider
    /// than `Limits.eventRangeMaxWindowDays`, so this asks for a year from
    /// today rather than "everything". A family that books nothing for a
    /// year sees an empty section, which is correct.
    ///
    /// The window starts at the **beginning of today**, not at `now`: an
    /// all-day event covering today, or a timed event that started an hour
    /// ago and is still running, both belong in "upcoming". Filtering by
    /// end time afterwards is what actually drops the past ones.
    private func loadUpcoming() async throws -> [CalendarEvent] {
        let reference = now()
        let startOfToday = dates.calendar.startOfDay(for: reference)
        guard let windowEnd = dates.calendar.date(
            byAdding: .day, value: Limits.eventRangeMaxWindowDays - 1, to: startOfToday
        ) else {
            return []
        }

        let fetched = try await api.listEvents(start: startOfToday, end: windowEnd)

        return fetched
            .compactMap { event -> (CalendarEvent, EventDates)? in
                // An event whose dates cannot be decoded is a contract
                // violation, not something to render half of.
                guard let parsed = event.dates else { return nil }
                return (event, parsed)
            }
            .filter { dates.hasEnded($0.1, asOf: reference) == false }
            .sorted { left, right in
                let a = dates.upcomingSortKey(for: left.1)
                let b = dates.upcomingSortKey(for: right.1)
                if a.day != b.day { return a.day < b.day }
                if a.kind != b.kind { return a.kind < b.kind }
                return a.instant < b.instant
            }
            .prefix(Self.upcomingEventCount)
            .map(\.0)
    }

    // MARK: - Formatting

    /// All date rendering goes through `CabinDate` (C27) so the Home screen
    /// and the calendar cannot disagree about what a range says.
    func dateLabel(for announcement: Announcement) -> String {
        dates.dateLabel(from: announcement.postedAt)
    }

    func rangeLabel(for event: CalendarEvent) -> String {
        guard let parsed = event.dates else { return "" }
        return dates.rangeLabel(for: parsed)
    }
}
