//
//  AnnouncementEditorView.swift
//  bearlake-client
//

import SwiftUI

/// Identifies what is being composed. A struct rather than a bare optional so
/// `.sheet(item:)` can distinguish "new" from "editing this one".
struct AnnouncementDraft: Identifiable {
    let existing: Announcement?
    var id: String { existing?.id ?? "new" }
}

/// Create or edit an announcement. Admin-only, enforced by the server.
///
/// `postedAt` is displayed but never editable: the server sets it on create
/// and an update sends **`{body}` and nothing else**. Sending anything more
/// is a 400 under the strict-body rule (C15).
struct AnnouncementEditorView: View {
    let api: BearLakeAPI
    let draft: AnnouncementDraft
    var onFinished: (Announcement?) -> Void

    @State private var text: String
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var isConfirmingDiscard = false
    @FocusState private var isFocused: Bool

    private let dates = CabinDate()

    init(api: BearLakeAPI, draft: AnnouncementDraft, onFinished: @escaping (Announcement?) -> Void) {
        self.api = api
        self.draft = draft
        self.onFinished = onFinished
        _text = State(initialValue: draft.existing?.body ?? "")
    }

    private var isEditing: Bool { draft.existing != nil }
    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var isOverLength: Bool { text.count > Limits.announcementBodyMax }
    /// The same rule the tests exercise, so the button and the assertion
    /// cannot drift apart.
    private var canSave: Bool {
        AnnouncementsViewModel.validationProblem(body: text) == nil && isSaving == false
    }
    private var hasChanges: Bool { trimmed != (draft.existing?.body ?? "") }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextEditor(text: $text)
                        .frame(minHeight: 160)
                        .focused($isFocused)
                        .accessibilityLabel("Announcement text")
                } header: {
                    Text("Announcement")
                } footer: {
                    VStack(alignment: .leading, spacing: 4) {
                        // Live counter, so the limit is visible before the
                        // server rejects it rather than after.
                        Text("\(text.count) / \(Limits.announcementBodyMax)")
                            .foregroundStyle(isOverLength ? .red : .secondary)
                        if let errorMessage {
                            Text(errorMessage).foregroundStyle(.red)
                        }
                    }
                }

                if let existing = draft.existing {
                    Section("Posted") {
                        Text(dates.dateLabel(from: existing.postedAt))
                            .foregroundStyle(.secondary)
                            .accessibilityLabel(
                                "Posted \(dates.dateLabel(from: existing.postedAt)). Not editable."
                            )
                    }
                }
            }
            .navigationTitle(isEditing ? "Edit Announcement" : "New Announcement")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if hasChanges {
                            isConfirmingDiscard = true
                        } else {
                            onFinished(nil)
                        }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Save", action: save).disabled(canSave == false)
                    }
                }
            }
            .confirmationDialog(
                "Discard this announcement?",
                isPresented: $isConfirmingDiscard,
                titleVisibility: .visible
            ) {
                Button("Discard", role: .destructive) { onFinished(nil) }
                Button("Keep Editing", role: .cancel) {}
            }
            .disabled(isSaving)
            .task { isFocused = true }
        }
    }

    private func save() {
        guard canSave else { return }
        isSaving = true
        errorMessage = nil
        Task {
            defer { isSaving = false }
            do {
                let saved: Announcement
                if let existing = draft.existing {
                    saved = try await api.updateAnnouncement(id: existing.id, body: trimmed)
                } else {
                    saved = try await api.createAnnouncement(body: trimmed)
                }
                onFinished(saved)
            } catch let error as APIError {
                errorMessage = error.message
            } catch {
                errorMessage = "Couldn't save that announcement."
            }
        }
    }
}

#Preview("New") {
    AnnouncementEditorView(
        api: PreviewAPI(), draft: AnnouncementDraft(existing: nil), onFinished: { _ in }
    )
}

#Preview("Editing") {
    AnnouncementEditorView(
        api: PreviewAPI(),
        draft: AnnouncementDraft(existing: Announcement(
            id: "1", body: "The marina passcode this summer is 845256.",
            postedAt: Date(timeIntervalSince1970: 1_785_585_600),
            createdBy: "u1",
            createdAt: Date(timeIntervalSince1970: 1_785_585_600),
            updatedAt: Date(timeIntervalSince1970: 1_785_585_600)
        )),
        onFinished: { _ in }
    )
}
