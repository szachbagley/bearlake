//
//  TextEntrySheet.swift
//  bearlake-client
//

import SwiftUI

/// A one-field editor, shared by quick tips and category names.
///
/// Both are a single piece of text with a length cap and a Save that stays
/// disabled until the text is valid. Two near-identical sheets would drift
/// apart; the differences are the title, the cap, and the validation rule, so
/// those are the parameters.
struct TextEntrySheet: View {
    let title: String
    let placeholder: String
    let characterLimit: Int
    // These three are `@MainActor` deliberately.
    //
    // The closures passed in capture `@MainActor` ViewModels and are
    // therefore MainActor-isolated, but a bare `(String) -> String?` property
    // type is NOT — storing them there erases the isolation instead of
    // preserving it. Swift 5 mode does not diagnose that, and the runtime
    // then calls them from the wrong context: the result was a bus error deep
    // inside `trimmingCharacters` when Save was tapped.
    /// Returns a complaint, or nil when the text is acceptable.
    let validate: @MainActor (String) -> String?
    /// Returns true on success; the sheet stays open on failure so the error
    /// is visible and the text is not lost.
    let onSave: @MainActor (String) async -> Bool
    var onCancel: @MainActor () -> Void
    /// Multi-line for a quick tip, single-line for a category name.
    var isMultiline: Bool = true

    @State private var text: String
    @State private var isSaving = false
    @State private var isConfirmingDiscard = false
    @FocusState private var isFocused: Bool

    private let initialText: String

    init(
        title: String,
        placeholder: String,
        initialText: String = "",
        characterLimit: Int,
        isMultiline: Bool = true,
        validate: @escaping @MainActor (String) -> String?,
        onSave: @escaping @MainActor (String) async -> Bool,
        onCancel: @escaping @MainActor () -> Void
    ) {
        self.title = title
        self.placeholder = placeholder
        self.characterLimit = characterLimit
        self.isMultiline = isMultiline
        self.validate = validate
        self.onSave = onSave
        self.onCancel = onCancel
        self.initialText = initialText
        _text = State(initialValue: initialText)
    }

    private var problem: String? { validate(text) }
    private var isOverLimit: Bool { text.count > characterLimit }
    private var hasChanges: Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
            != initialText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if isMultiline {
                        TextEditor(text: $text)
                            .frame(minHeight: 120)
                            .focused($isFocused)
                            .accessibilityLabel(placeholder)
                    } else {
                        TextField(placeholder, text: $text)
                            .focused($isFocused)
                    }
                } footer: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(text.count) / \(characterLimit)")
                            .foregroundStyle(isOverLimit ? .red : .secondary)
                        if let problem, text.isEmpty == false {
                            Text(problem).foregroundStyle(.red)
                        }
                    }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if hasChanges { isConfirmingDiscard = true } else { onCancel() }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Save", action: save).disabled(problem != nil)
                    }
                }
            }
            .confirmationDialog(
                "Discard your changes?",
                isPresented: $isConfirmingDiscard,
                titleVisibility: .visible
            ) {
                Button("Discard", role: .destructive) { onCancel() }
                Button("Keep Editing", role: .cancel) {}
            }
            .disabled(isSaving)
            .task { isFocused = true }
        }
    }

    private func save() {
        guard problem == nil else { return }
        isSaving = true
        Task {
            defer { isSaving = false }
            if await onSave(text) { onCancel() }
        }
    }
}

// Previews are DEBUG-only: the `#Preview` macro's generated code compiles in
// every configuration, and it references `PreviewAPI` / `.preview()`, which
// live behind `#if DEBUG` in PreviewSupport.swift so no test double ever
// reaches a shipping binary. Without this guard the Release build does not
// compile — which is how it stayed broken until Phase 11 built it.
#if DEBUG
#Preview("Quick tip") {
    TextEntrySheet(
        title: "New Quick Tip",
        placeholder: "Quick tip",
        characterLimit: Limits.quickTipBodyMax,
        validate: InformationViewModel.quickTipProblem(body:),
        onSave: { _ in true },
        onCancel: {}
    )
}

#Preview("Category") {
    TextEntrySheet(
        title: "New Category",
        placeholder: "Category name",
        characterLimit: Limits.categoryTitleMax,
        isMultiline: false,
        validate: InformationViewModel.categoryProblem(title:),
        onSave: { _ in true },
        onCancel: {}
    )
}
#endif
