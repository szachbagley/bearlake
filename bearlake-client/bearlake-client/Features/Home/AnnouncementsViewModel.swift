//
//  AnnouncementsViewModel.swift
//  bearlake-client
//

import Foundation
import Observation

/// The full announcements list, paginated by the server's opaque cursor.
@MainActor
@Observable
final class AnnouncementsViewModel {
    private(set) var announcements: [Announcement] = []
    private(set) var isLoading = false
    private(set) var isLoadingMore = false
    /// Nil once the server says there is nothing after this page.
    private(set) var nextCursor: String?
    private(set) var hasLoadedOnce = false
    var errorMessage: String?

    private let api: BearLakeAPI
    private let dates: CabinDate

    init(api: BearLakeAPI, dates: CabinDate = CabinDate()) {
        self.api = api
        self.dates = dates
    }

    var canLoadMore: Bool { nextCursor != nil && isLoadingMore == false }

    /// First page, or a pull-to-refresh. Resets rather than appends, so a
    /// refresh after a delete cannot leave a phantom row behind.
    func load() async {
        guard isLoading == false else { return }
        isLoading = true
        defer { isLoading = false; hasLoadedOnce = true }

        do {
            let page = try await api.listAnnouncements(
                limit: Limits.announcementListLimitDefault, cursor: nil
            )
            announcements = page.items
            nextCursor = page.nextCursor
            errorMessage = nil
        } catch let error as APIError {
            errorMessage = error.message
        } catch {
            errorMessage = "Couldn't load announcements."
        }
    }

    /// Appends the next page.
    ///
    /// De-duplicates by id on the way in. The cursor is opaque and the list
    /// is ordered by a timestamp that is not guaranteed unique, so a row
    /// sitting exactly on a page boundary can legitimately come back twice —
    /// which would crash a `ForEach` keyed on `id`, not merely look wrong.
    func loadMore() async {
        guard let cursor = nextCursor, isLoadingMore == false, isLoading == false else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }

        do {
            let page = try await api.listAnnouncements(
                limit: Limits.announcementListLimitDefault, cursor: cursor
            )
            let known = Set(announcements.map(\.id))
            announcements.append(contentsOf: page.items.filter { known.contains($0.id) == false })
            nextCursor = page.nextCursor
            errorMessage = nil
        } catch let error as APIError {
            errorMessage = error.message
        } catch {
            errorMessage = "Couldn't load more announcements."
        }
    }

    // MARK: - Mutations (admin only; the server enforces it)

    func delete(_ announcement: Announcement) async {
        do {
            try await api.deleteAnnouncement(id: announcement.id)
            announcements.removeAll { $0.id == announcement.id }
        } catch let error as APIError {
            // A member who somehow reached this path gets the server's own
            // explanation rather than a swallowed failure.
            errorMessage = error.message
        } catch {
            errorMessage = "Couldn't delete that announcement."
        }
    }

    /// Folds a created or edited announcement back into the list without a
    /// full refetch.
    func merge(_ announcement: Announcement) {
        if let index = announcements.firstIndex(where: { $0.id == announcement.id }) {
            announcements[index] = announcement
        } else {
            announcements.insert(announcement, at: 0)
        }
    }

    func dateLabel(for announcement: Announcement) -> String {
        dates.dateLabel(from: announcement.postedAt)
    }

    // MARK: - Validation

    /// Why an announcement body cannot be saved, or nil when it can.
    ///
    /// Lives here rather than inside the editor view so it is testable
    /// without rendering: the point of the check is that an over-length body
    /// never reaches the network, and that has to be provable.
    static func validationProblem(body: String) -> String? {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.count < Limits.announcementBodyMin {
            return "An announcement needs some text."
        }
        if body.count > Limits.announcementBodyMax {
            return "That's \(body.count - Limits.announcementBodyMax) characters too long."
        }
        return nil
    }
}
