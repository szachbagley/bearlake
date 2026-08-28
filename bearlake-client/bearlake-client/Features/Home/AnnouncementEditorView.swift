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
/// and an update sends **`{body}` and nothing else** (C15). All of that lives
/// in `AnnouncementEditorViewModel`; this file is presentation only.
struct AnnouncementEditorView: View {
    @State private var model: AnnouncementEditorViewModel
    var onFinished: @MainActor (Announcement?) -> Void

    @State private var isConfirmingDiscard = false
    @FocusState private var isFocused: Bool

    init(
        api: BearLakeAPI,
        draft: AnnouncementDraft,
        onFinished: @escaping @MainActor (Announcement?) -> Void
    ) {
        _model = State(initialValue: AnnouncementEditorViewModel(
            api: api, existing: draft.existing
        ))
        self.onFinished = onFinished
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextEditor(text: Binding(
                        get: { model.text }, set: { model.setText($0) }
                    ))
                    .frame(minHeight: 160)
                    .focused($isFocused)
                    .accessibilityLabel("Announcement text")
                } header: {
                    Text("Announcement")
                } footer: {
                    VStack(alignment: .leading, spacing: 4) {
                        // Live counter, so the limit is visible before the
                        // server rejects it rather than after.
                        Text("\(model.characterCount) / \(Limits.announcementBodyMax)")
                            .foregroundStyle(model.isOverLength ? .red : .secondary)
                        if let errorMessage = model.errorMessage {
                            Text(errorMessage).foregroundStyle(.red)
                        }
                    }
                }

                if let postedLabel = model.postedLabel {
                    Section("Posted") {
                        Text(postedLabel)
                            .foregroundStyle(.secondary)
                            .accessibilityLabel("Posted \(postedLabel). Not editable.")
                    }
                }
            }
            .navigationTitle(model.isEditing ? "Edit Announcement" : "New Announcement")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if model.hasChanges {
                            isConfirmingDiscard = true
                        } else {
                            onFinished(nil)
                        }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if model.isSaving {
                        ProgressView()
                    } else {
                        Button("Save") {
                            Task {
                                if let saved = await model.save() { onFinished(saved) }
                            }
                        }
                        .disabled(model.canSave == false)
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
            .disabled(model.isSaving)
            .task { isFocused = true }
        }
    }
}

// Previews are DEBUG-only: the `#Preview` macro's generated code compiles in
// every configuration, and it references `PreviewAPI` / `.preview()`, which
// live behind `#if DEBUG` in PreviewSupport.swift so no test double ever
// reaches a shipping binary. Without this guard the Release build does not
// compile — which is how it stayed broken until Phase 11 built it.
#if DEBUG
#Preview("New") {
    AnnouncementEditorView(
        api: PreviewAPI(), draft: AnnouncementDraft(existing: nil), onFinished: { _ in }
    )
}

#Preview("Editing") {
    AnnouncementEditorView(
        api: PreviewAPI(),
        draft: AnnouncementDraft(existing: Announcement(
            id: "a1",
            body: "The marina gate code changed to 4417 for the rest of the season.",
            postedAt: Date(),
            createdBy: "u1",
            createdAt: Date(),
            updatedAt: Date()
        )),
        onFinished: { _ in }
    )
}
#endif
