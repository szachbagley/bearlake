//
//  BlockEditorSheet.swift
//  bearlake-client
//

import SwiftUI

/// A focused editor for one block (step 4).
///
/// Tapping a block opens only that block, rather than editing inline in the
/// list. A `List` row that is simultaneously draggable and a text field
/// fights itself — the drag gesture and the caret compete — and the caps are
/// easier to show with room.
struct BlockEditorSheet: View {
    let original: Block
    /// The article view's cache, shared rather than rebuilt: a fresh actor
    /// here would re-download an image the page just displayed, which is the
    /// exact re-fetch a key-based cache exists to prevent (C35).
    let cache: ImageCache
    var onSave: @MainActor (Block) -> Void
    var onCancel: @MainActor () -> Void

    @State private var text: String = ""
    @State private var items: [String] = []
    @State private var caption: String = ""
    @State private var videoInput: String = ""
    @FocusState private var isFocused: Bool

    init(
        original: Block,
        cache: ImageCache,
        onSave: @escaping @MainActor (Block) -> Void,
        onCancel: @escaping @MainActor () -> Void
    ) {
        self.original = original
        self.cache = cache
        self.onSave = onSave
        self.onCancel = onCancel

        switch original {
        case .heading(_, let value), .paragraph(_, let value):
            _text = State(initialValue: value)
        case .bullets(_, let value):
            _items = State(initialValue: value.isEmpty ? [""] : value)
        case .image(_, _, let value, _):
            _caption = State(initialValue: value ?? "")
        case .video(_, let videoID, let value):
            _videoInput = State(initialValue: videoID)
            _caption = State(initialValue: value ?? "")
        case .unknown:
            break
        }
    }

    private var edited: Block? {
        switch original {
        case .heading(let id, _): return .heading(id: id, text: text)
        case .paragraph(let id, _): return .paragraph(id: id, text: text)
        case .bullets(let id, _):
            return .bullets(id: id, items: items.filter { $0.isEmpty == false })
        case .image(let id, let key, _, let url):
            return .image(id: id, key: key, caption: caption.isEmpty ? nil : caption, url: url)
        case .video(let id, _, _):
            // Accepts a pasted URL in any shape, or a bare id, and stores the
            // id alone (C37).
            guard let videoID = YouTube.extractID(from: videoInput) else { return nil }
            return .video(id: id, videoId: videoID, caption: caption.isEmpty ? nil : caption)
        case .unknown:
            return nil
        }
    }

    private var problem: String? {
        guard let edited else {
            if case .video = original { return "That isn't a YouTube link or video id." }
            return nil
        }
        return ArticleEditorViewModel.problem(with: edited)
    }

    var body: some View {
        NavigationStack {
            Form { fields }
                .navigationTitle(navigationTitle)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel", action: onCancel)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") {
                            if let edited { onSave(edited) }
                        }
                        .disabled(problem != nil || edited == nil)
                    }
                }
                .task { isFocused = true }
        }
    }

    private var navigationTitle: String {
        switch original {
        case .heading: return "Heading"
        case .paragraph: return "Paragraph"
        case .bullets: return "Bullet List"
        case .image: return "Photo"
        case .video: return "Video"
        case .unknown: return "Block"
        }
    }

    @ViewBuilder
    private var fields: some View {
        switch original {
        case .heading:
            Section {
                TextField("Heading", text: $text, axis: .vertical)
                    .focused($isFocused)
            } footer: {
                counter(text.count, Limits.headingTextMax)
            }

        case .paragraph:
            Section {
                TextEditor(text: $text)
                    .frame(minHeight: 200)
                    .focused($isFocused)
                    .accessibilityLabel("Paragraph text")
            } footer: {
                counter(text.count, Limits.paragraphTextMax)
            }

        case .bullets:
            Section {
                ForEach(items.indices, id: \.self) { index in
                    TextField("Item", text: Binding(
                        get: { items.indices.contains(index) ? items[index] : "" },
                        set: { if items.indices.contains(index) { items[index] = $0 } }
                    ), axis: .vertical)
                }
                .onDelete { items.remove(atOffsets: $0) }
                Button {
                    items.append("")
                } label: {
                    Label("Add item", systemImage: "plus")
                }
                .disabled(items.count >= Limits.bulletItemsMax)
            } footer: {
                if let problem {
                    Text(problem).foregroundStyle(.red)
                } else {
                    Text("\(items.count) of \(Limits.bulletItemsMax) items")
                }
            }

        case .image(_, let key, _, let url):
            Section("Photo") {
                CachedAsyncImage(
                    key: key, url: url.flatMap(URL.init(string:)), cache: cache
                )
                .frame(maxHeight: 200)
            }
            Section {
                TextField("Caption (optional)", text: $caption, axis: .vertical)
                    .focused($isFocused)
            } footer: {
                counter(caption.count, Limits.blockCaptionMax)
            }

        case .video:
            Section {
                TextField("YouTube link or video id", text: $videoInput)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($isFocused)
                TextField("Caption (optional)", text: $caption, axis: .vertical)
            } footer: {
                if let problem {
                    Text(problem).foregroundStyle(.red)
                } else if let videoID = YouTube.extractID(from: videoInput) {
                    Text("Video id: \(videoID)")
                }
            }

        case .unknown:
            // Step 5: read-only, and explicitly reassuring. An admin on an
            // older build must not think their content is about to be lost.
            Section {
                Text("Unsupported block — preserved on save")
                    .foregroundStyle(.secondary)
            } footer: {
                Text("This was made with a newer version of the app. "
                     + "It can't be edited here, but it stays exactly as it is.")
            }
        }
    }

    private func counter(_ count: Int, _ limit: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(count) / \(limit)")
                .foregroundStyle(count > limit ? .red : .secondary)
            if let problem {
                Text(problem).foregroundStyle(.red)
            }
        }
    }
}

// Previews are DEBUG-only: the `#Preview` macro's generated code compiles in
// every configuration, and it references `PreviewAPI` / `.preview()`, which
// live behind `#if DEBUG` in PreviewSupport.swift so no test double ever
// reaches a shipping binary. Without this guard the Release build does not
// compile — which is how it stayed broken until Phase 11 built it.
#if DEBUG
#Preview("Paragraph") {
    BlockEditorSheet(
        original: .paragraph(id: "1", text: "Check the chlorine level weekly."),
        cache: ImageCache(),
        onSave: { _ in }, onCancel: {}
    )
}

#Preview("Unknown") {
    BlockEditorSheet(
        original: .unknown(UnknownBlock(id: "1", type: "table", raw: [:])),
        cache: ImageCache(),
        onSave: { _ in }, onCancel: {}
    )
}
#endif
