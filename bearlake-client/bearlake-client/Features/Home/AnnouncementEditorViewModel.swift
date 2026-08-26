//
//  AnnouncementEditorViewModel.swift
//  bearlake-client
//
//  Phase 11, step 1. Extracted from `AnnouncementEditorView`, which was the
//  one editor in the app still doing its own networking, save state, and
//  error handling inside a `View` — every other one already had a ViewModel.
//  Found by the §6 checklist pass rather than by a failure.
//

import Foundation
import Observation

@MainActor
@Observable
final class AnnouncementEditorViewModel {
    /// Nil when composing a new announcement.
    let existing: Announcement?

    private(set) var text: String
    private(set) var isSaving = false
    var errorMessage: String?

    private let api: BearLakeAPI
    private let dates: CabinDate

    init(api: BearLakeAPI, existing: Announcement?, dates: CabinDate = CabinDate()) {
        self.api = api
        self.existing = existing
        self.dates = dates
        self.text = existing?.body ?? ""
    }

    var isEditing: Bool { existing != nil }
    var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    var characterCount: Int { text.count }
    var isOverLength: Bool { text.count > Limits.announcementBodyMax }

    /// The same rule the tests exercise, so the button and the assertion
    /// cannot drift apart.
    var canSave: Bool {
        AnnouncementsViewModel.validationProblem(body: text) == nil && isSaving == false
    }

    var hasChanges: Bool { trimmed != (existing?.body ?? "") }

    /// The posted date, formatted. In the ViewModel because date formatting
    /// in a view `body` is exactly what the checklist forbids (C27).
    var postedLabel: String? {
        existing.map { dates.dateLabel(from: $0.postedAt) }
    }

    func setText(_ value: String) {
        text = value
    }

    /// - Returns: the saved announcement, or nil when the save failed.
    func save() async -> Announcement? {
        guard canSave else { return nil }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        do {
            // An update sends `{body}` and nothing else — `postedAt` is the
            // server's, and sending more is a 400 under the strict-body rule
            // (C15).
            if let existing {
                return try await api.updateAnnouncement(id: existing.id, body: trimmed)
            }
            return try await api.createAnnouncement(body: trimmed)
        } catch let error as APIError {
            errorMessage = error.message
            return nil
        } catch {
            errorMessage = "Couldn't save that announcement."
            return nil
        }
    }
}
