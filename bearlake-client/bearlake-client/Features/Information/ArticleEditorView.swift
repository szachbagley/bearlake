//
//  ArticleEditorView.swift
//  bearlake-client
//

import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

/// The article editor (admin only). Secondary authoring surface — the web app
/// is primary — so it is built for iterating on an existing article rather
/// than writing one from scratch.
struct ArticleEditorView: View {
    @State private var model: ArticleEditorViewModel
    let categories: [InfoCategory]
    var onFinished: @MainActor () -> Void

    @State private var editingBlock: Block?
    @State private var photoItem: PhotosPickerItem?
    @State private var isConfirmingDiscard = false

    /// Shared with the article view behind it, so a photo it already fetched
    /// is not downloaded again when its block is opened for a caption (C35).
    private let cache: ImageCache

    init(
        articleID: String,
        api: BearLakeAPI,
        categories: [InfoCategory],
        cache: ImageCache,
        onFinished: @escaping @MainActor () -> Void
    ) {
        _model = State(initialValue: ArticleEditorViewModel(
            articleID: articleID, api: api, cache: cache
        ))
        self.categories = categories
        self.cache = cache
        self.onFinished = onFinished
    }

    /// The editor loads the full list so an article can be moved between
    /// categories; the list passed in is the fallback until that lands.
    private var pickerCategories: [InfoCategory] {
        model.categories.isEmpty ? categories : model.categories
    }

    var body: some View {
        NavigationStack {
            List {
                detailsSection
                blocksSection
                addSection
            }
            // Editing before the load returns is a silent data-loss path: the
            // response overwrites whatever was typed and resets isDirty, so
            // there is not even an unsaved-changes warning. The toolbar stays
            // live, so Cancel still works.
            .disabled(model.hasLoadedOnce == false)
            .overlay {
                if model.hasLoadedOnce == false {
                    ProgressView().accessibilityLabel("Loading article")
                }
            }
            .navigationTitle("Edit Article")
            .navigationBarTitleDisplayMode(.inline)
            .task { await model.load() }
            .toolbar { toolbar }
            .environment(\.editMode, .constant(.active))
            .sheet(item: $editingBlock) { block in
                BlockEditorSheet(
                    original: block,
                    cache: cache,
                    onSave: { edited in
                        model.replace(edited)
                        editingBlock = nil
                    },
                    onCancel: { editingBlock = nil }
                )
            }
            .confirmationDialog(
                "Discard your changes?",
                isPresented: $isConfirmingDiscard,
                titleVisibility: .visible
            ) {
                Button("Discard", role: .destructive, action: onFinished)
                Button("Keep Editing", role: .cancel) {}
            } message: {
                Text("This article hasn't been saved.")
            }
            // C39. Non-dismissable by design: the choice has to be made,
            // because the alternative is silently losing one side's work.
            .alert("This article changed", isPresented: Binding(
                get: { model.conflict != nil },
                set: { if $0 == false { model.dismissConflict() } }
            )) {
                Button("Copy My Changes") {
                    if let json = model.changesJSONForPasteboard() {
                        copyToPasteboard(json)
                    }
                    Task { await model.reloadAfterConflict() }
                }
                Button("Reload", role: .destructive) {
                    Task { await model.reloadAfterConflict() }
                }
            } message: {
                Text("Someone else saved this article while you were editing. "
                     + "Reload to take their version, or copy your changes first.")
            }
            .alert("Something went wrong", isPresented: Binding(
                get: { model.errorMessage != nil },
                set: { if $0 == false { model.errorMessage = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(model.errorMessage ?? "")
            }
            .interactiveDismissDisabled(model.isDirty)
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                Task {
                    do {
                        // A nil payload is a real outcome, not just an error:
                        // an iCloud asset that fails to download comes back
                        // empty. Either way the user tapped a photo and must
                        // not be met with silence.
                        guard let data = try await item.loadTransferable(type: Data.self) else {
                            model.errorMessage = "That photo couldn't be loaded. "
                                + "If it's stored in iCloud, open it in Photos first."
                            photoItem = nil
                            return
                        }
                        await model.addPhoto(data)
                    } catch {
                        model.errorMessage = "That photo couldn't be loaded."
                    }
                    photoItem = nil
                }
            }
        }
    }

    /// Writes the rescued edits to the pasteboard (C54).
    ///
    /// `UIPasteboard` is UIKit, and the only programmatic clipboard write iOS
    /// 17 offers — SwiftUI's `.copyable` needs focus and a selection,
    /// `ShareLink` is a share sheet and cannot live inside an `.alert`, and
    /// `PasteButton` reads rather than writes.
    ///
    /// Written with `setItems` rather than `.string` because an article can
    /// document a gate code or where the keys live, and the general pasteboard
    /// is readable by every other app and syncs to the admin's Mac and iPad by
    /// default. `localOnly` keeps it on this device; the expiry clears it
    /// without anyone having to remember to.
    private func copyToPasteboard(_ json: String) {
        UIPasteboard.general.setItems(
            [[UTType.utf8PlainText.identifier: json]],
            options: [
                .localOnly: true,
                .expirationDate: Date().addingTimeInterval(600),
            ]
        )
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button("Cancel") {
                if model.isDirty { isConfirmingDiscard = true } else { onFinished() }
            }
        }
        ToolbarItem(placement: .confirmationAction) {
            if model.isSaving {
                ProgressView()
            } else {
                Button("Save") {
                    Task { if await model.save() { onFinished() } }
                }
                .disabled(model.canSave == false)
            }
        }
    }

    private var detailsSection: some View {
        Section {
            TextField("Title", text: Binding(
                get: { model.title }, set: { model.setTitle($0) }
            ))

            Picker("Category", selection: Binding(
                get: { model.categoryID }, set: { model.setCategory($0) }
            )) {
                ForEach(pickerCategories) { category in
                    Text(category.title).tag(category.id)
                }
            }

            Picker("Status", selection: Binding(
                get: { model.status }, set: { model.setStatus($0) }
            )) {
                Text("Draft").tag(ArticleStatus.draft)
                Text("Published").tag(ArticleStatus.published)
            }
            .pickerStyle(.segmented)
        } footer: {
            // Validation first. Articles are authored as drafts, so a draft
            // note in front of it would hide the message in exactly the state
            // that needs it — Save greys out with nothing explaining why.
            if let problem = model.validationProblem {
                Text(problem).foregroundStyle(.red)
            } else if model.status == .draft {
                Text("Drafts are only visible to admins.")
            } else if model.isDirty {
                Text("Unsaved changes.")
            }
        }
    }

    private var blocksSection: some View {
        Section("Content") {
            ForEach(model.blocks) { block in
                Button {
                    editingBlock = block
                } label: {
                    BlockRow(block: block)
                }
                .buttonStyle(.plain)
            }
            // Native List reordering (step 2, C-plan): the platform-idiomatic
            // gesture, and free. The web app uses move buttons because the
            // browser gives it nothing better.
            .onMove { model.move(from: $0, to: $1) }
            .onDelete { model.delete(at: $0) }

            if let progress = model.uploadProgress {
                HStack {
                    ProgressView(value: progress)
                    Text("\(Int(progress * 100))%")
                        .font(.caption)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                .accessibilityLabel("Uploading photo, \(Int(progress * 100)) percent")
            }
        }
    }

    private var addSection: some View {
        Section {
            Menu {
                Button("Heading") { model.append(.heading) }
                Button("Paragraph") { model.append(.paragraph) }
                Button("Bullet list") { model.append(.bullets) }
                Button("Video") { model.append(.video) }
            } label: {
                Label("Add block", systemImage: "plus")
            }

            // PhotosPicker (C40): native, and the modern picker needs no
            // permission prompt because the app never sees the library.
            PhotosPicker(selection: $photoItem, matching: .images) {
                Label("Add photo", systemImage: "photo")
            }
            .disabled(model.uploadProgress != nil)
        }
    }
}

/// One row in the reorderable list. Deliberately a summary, not an editor —
/// tapping opens the focused sheet.
private struct BlockRow: View {
    let block: Block

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .foregroundStyle(.secondary)
                .frame(width: 22)
            Text(summary)
                .lineLimit(2)
                .foregroundStyle(block.isUnknown ? .secondary : .primary)
            Spacer()
        }
        .accessibilityElement(children: .combine)
    }

    private var symbol: String {
        switch block {
        case .heading: return "textformat.size.larger"
        case .paragraph: return "text.alignleft"
        case .bullets: return "list.bullet"
        case .image: return "photo"
        case .video: return "play.rectangle"
        case .unknown: return "questionmark.square.dashed"
        }
    }

    private var summary: String {
        switch block {
        case .heading(_, let text): return text.isEmpty ? "Empty heading" : text
        case .paragraph(_, let text): return text.isEmpty ? "Empty paragraph" : text
        case .bullets(_, let items):
            return items.first.map { "\($0)…" } ?? "Empty list"
        case .image(_, _, let caption, _): return caption ?? "Photo"
        case .video(_, let videoID, let caption):
            return caption ?? (videoID.isEmpty ? "No video chosen" : "Video \(videoID)")
        case .unknown:
            // Step 5. The wording is the reassurance: an admin on an older
            // build must not think their content is about to be lost.
            return "Unsupported block — preserved on save"
        }
    }
}

// Previews are DEBUG-only: the `#Preview` macro's generated code compiles in
// every configuration, and it references `PreviewAPI` / `.preview()`, which
// live behind `#if DEBUG` in PreviewSupport.swift so no test double ever
// reaches a shipping binary. Without this guard the Release build does not
// compile — which is how it stayed broken until Phase 11 built it.
#if DEBUG
#Preview {
    ArticleEditorView(
        articleID: "a1", api: PreviewAPI(),
        categories: [InfoCategory(
            id: "cat0", title: "Pool & Hot Tub", sortOrder: 0,
            createdAt: Date(), updatedAt: Date()
        )],
        cache: ImageCache(),
        onFinished: {}
    )
}
#endif
