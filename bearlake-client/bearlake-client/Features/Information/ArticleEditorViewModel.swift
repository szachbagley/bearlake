//
//  ArticleEditorViewModel.swift
//  bearlake-client
//

import Foundation
import Observation

@MainActor
@Observable
final class ArticleEditorViewModel {
    /// What a 409 offers (C39). Never auto-overwrite — a silent overwrite is
    /// the one real data-loss path in this project.
    enum Conflict: Equatable {
        case stale
    }

    let articleID: String

    private(set) var title: String = ""
    private(set) var status: ArticleStatus = .draft
    private(set) var categoryID: String = ""
    private(set) var blocks: [Block] = []

    private(set) var isLoading = false
    private(set) var isSaving = false
    private(set) var hasLoadedOnce = false
    /// The optimistic-lock token from the load. Sent on every PATCH (C39).
    private(set) var loadedUpdatedAt: Date?
    private(set) var conflict: Conflict?
    /// Progress of an in-flight photo upload, nil when none (C43).
    private(set) var uploadProgress: Double?

    var errorMessage: String?

    /// Explicit save only (step 8), so this drives both the Save button and
    /// the dismiss warning.
    private(set) var isDirty = false

    /// Categories the article can be moved to, loaded alongside it.
    private(set) var categories: [InfoCategory] = []

    private let api: BearLakeAPI
    private let uploader: ImageUploader
    private let cache: ImageCache?

    /// Identifies the upload currently in flight, or nil when none. A
    /// progress callback that does not match is stale and ignored — including
    /// one from the upload that just finished. See `addPhoto`.
    private var uploadGeneration = 0
    private var activeUpload: Int?

    init(
        articleID: String,
        api: BearLakeAPI,
        uploader: ImageUploader? = nil,
        cache: ImageCache? = nil
    ) {
        self.articleID = articleID
        self.api = api
        self.uploader = uploader ?? ImageUploader(api: api)
        self.cache = cache
    }

    // MARK: - Load

    func load() async {
        guard isLoading == false else { return }
        isLoading = true
        defer { isLoading = false; hasLoadedOnce = true }
        do {
            let article = try await api.getArticle(id: articleID)
            apply(article)
            errorMessage = nil
            // Secondary, and deliberately not fatal: without it the picker
            // falls back to showing only the current category, which is the
            // old behaviour rather than a broken screen.
            categories = (try? await api.listCategories()) ?? []
        } catch let error as APIError {
            errorMessage = error.message
        } catch {
            errorMessage = "Couldn't load this article."
        }
    }

    private func apply(_ article: InfoArticle) {
        title = article.title
        status = article.status
        categoryID = article.categoryId
        blocks = article.blocks
        loadedUpdatedAt = article.updatedAt
        isDirty = false
        conflict = nil
    }

    // MARK: - Editing

    func setTitle(_ value: String) {
        guard value != title else { return }
        title = value
        isDirty = true
    }

    func setStatus(_ value: ArticleStatus) {
        guard value != status else { return }
        status = value
        isDirty = true
    }

    func setCategory(_ value: String) {
        guard value != categoryID else { return }
        categoryID = value
        isDirty = true
    }

    /// Appends a new block. Every one gets a fresh lowercase UUID (C33) — ids
    /// are the identity for reorder, edit, and `List` diffing, and the server
    /// validates the format.
    func append(_ kind: NewBlockKind) {
        let id = Block.newID()
        switch kind {
        case .heading: blocks.append(.heading(id: id, text: ""))
        case .paragraph: blocks.append(.paragraph(id: id, text: ""))
        case .bullets: blocks.append(.bullets(id: id, items: [""]))
        case .video: blocks.append(.video(id: id, videoId: "", caption: nil))
        }
        isDirty = true
    }

    enum NewBlockKind: CaseIterable {
        case heading, paragraph, bullets, video
    }

    func replace(_ block: Block) {
        guard let index = blocks.firstIndex(where: { $0.id == block.id }) else { return }
        guard blocks[index] != block else { return }
        blocks[index] = block
        isDirty = true
    }

    /// `.onMove` (step 2). Native `List` reordering, unlike the web app's
    /// move buttons — this is the platform-idiomatic gesture and it is free.
    ///
    /// Implemented by hand rather than with `Array.move(fromOffsets:toOffset:)`
    /// because that lives in SwiftUI, and a ViewModel does not import the view
    /// layer. The semantics match SwiftUI's: `destination` is an index in the
    /// list *before* removal, so it has to be adjusted by however many moved
    /// items sat above it.
    func move(from source: IndexSet, to destination: Int) {
        let ascending = source.sorted()
        guard ascending.allSatisfy(blocks.indices.contains) else { return }

        let moving = ascending.map { blocks[$0] }
        var remaining = blocks
        for index in ascending.reversed() { remaining.remove(at: index) }

        let above = ascending.filter { $0 < destination }.count
        let insertionPoint = min(max(destination - above, 0), remaining.count)
        remaining.insert(contentsOf: moving, at: insertionPoint)

        guard remaining != blocks else { return }
        blocks = remaining
        isDirty = true
    }

    func delete(at offsets: IndexSet) {
        let removable = offsets.sorted().filter(blocks.indices.contains)
        guard removable.isEmpty == false else { return }
        for index in removable.reversed() { blocks.remove(at: index) }
        isDirty = true
    }

    // MARK: - Photos

    /// Uploads a picked photo and appends an image block holding the returned
    /// **key**. The presigned URL is never stored (C34).
    func addPhoto(_ data: Data) async {
        // The progress callback arrives on URLSession's delegate queue and
        // hops to the MainActor as its own Task, so it is not ordered against
        // this function's resumption: the final 1.0 can land *after* the
        // cleanup below and strand `uploadProgress` at a non-nil value
        // forever, which permanently disables the photo picker. Stamping each
        // upload and ignoring callbacks from stale generations makes the
        // ordering irrelevant.
        uploadGeneration += 1
        let generation = uploadGeneration
        activeUpload = generation
        uploadProgress = 0
        // Clearing `activeUpload` is what makes the guard below reject the
        // final callback too — it can land after this runs.
        defer {
            if activeUpload == generation {
                activeUpload = nil
                uploadProgress = nil
            }
        }
        do {
            let prepared = try await uploader.upload(data, articleID: articleID) { [weak self] value in
                Task { @MainActor [weak self] in
                    guard let self, self.activeUpload == generation else { return }
                    self.uploadProgress = value
                }
            }
            // Seed the cache with the exact bytes that went to S3 so the new
            // block previews immediately; the block itself still carries only
            // the key (C34, C35).
            await cache?.insert(prepared.data, forKey: prepared.key)
            // url is nil: this block has never been read back from the API,
            // so there is no presigned URL yet. The next load supplies one.
            blocks.append(.image(id: Block.newID(), key: prepared.key, caption: nil, url: nil))
            isDirty = true
        } catch let error as ImageUploadError {
            errorMessage = error.message
        } catch let error as APIError {
            errorMessage = error.message
        } catch {
            errorMessage = "That photo couldn't be added."
        }
    }

    // MARK: - Validation

    /// Mirrors the server's block rules so a known-bad article never leaves
    /// the device.
    var validationProblem: String? {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedTitle.count < Limits.articleTitleMin { return "An article needs a title." }
        if trimmedTitle.count > Limits.articleTitleMax { return "That title is too long." }
        if blocks.count > Limits.maxBlocksPerArticle { return "That's too many blocks." }

        for block in blocks {
            if let problem = Self.problem(with: block) { return problem }
        }
        // Duplicate ids would be rejected by the server and would also break
        // List diffing here.
        if Set(blocks.map(\.id)).count != blocks.count { return "Two blocks share an id." }
        return nil
    }

    static func problem(with block: Block) -> String? {
        switch block {
        case .heading(_, let text):
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.count < Limits.headingTextMin { return "A heading can't be empty." }
            if text.count > Limits.headingTextMax { return "A heading is too long." }
        case .paragraph(_, let text):
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.count < Limits.paragraphTextMin { return "A paragraph can't be empty." }
            if text.count > Limits.paragraphTextMax { return "A paragraph is too long." }
        case .bullets(_, let items):
            if items.count < Limits.bulletItemsMin { return "A bullet list needs an item." }
            if items.count > Limits.bulletItemsMax { return "That bullet list has too many items." }
            for item in items {
                let trimmed = item.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed.count < Limits.bulletItemTextMin { return "A bullet can't be empty." }
                if item.count > Limits.bulletItemTextMax { return "A bullet is too long." }
            }
        case .image(_, _, let caption, _):
            if let caption, caption.count > Limits.blockCaptionMax { return "A caption is too long." }
        case .video(_, let videoID, let caption):
            if YouTube.isValidID(videoID) == false { return "A video needs a valid YouTube link." }
            if let caption, caption.count > Limits.blockCaptionMax { return "A caption is too long." }
        case .unknown:
            // Never validated and never edited — it is round-tripped
            // unchanged (C31), and this build has no idea what its rules are.
            break
        }
        return nil
    }

    /// `uploadProgress` is part of this: saving mid-upload dismisses the
    /// editor, and when the PUT finally lands `addPhoto` appends the block to
    /// a ViewModel nobody is showing. The photo silently never reaches the
    /// article and the S3 object is orphaned.
    var canSave: Bool {
        validationProblem == nil && isSaving == false && isDirty && uploadProgress == nil
    }

    // MARK: - Save (step 7)

    /// - Returns: true when the article saved.
    @discardableResult
    func save() async -> Bool {
        if let problem = validationProblem {
            errorMessage = problem
            return false
        }
        // No token means the load never succeeded. Saving would either
        // overwrite blindly or be rejected, and returning quietly would make
        // Save look broken — the button would simply do nothing.
        guard let updatedAt = loadedUpdatedAt else {
            errorMessage = "This article hasn't finished loading yet. "
                + "Close and reopen it, then try again."
            return false
        }
        isSaving = true
        defer { isSaving = false }

        do {
            let saved = try await api.updateArticle(
                id: articleID,
                UpdateArticleRequest(
                    updatedAt: updatedAt,
                    categoryId: categoryID,
                    title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                    // Image blocks encode without `url` by construction
                    // (C34) — there is nothing to strip, because writing it
                    // is unrepresentable.
                    blocks: blocks,
                    status: status
                )
            )
            apply(saved)
            return true
        } catch let error as APIError {
            if error.is(.staleArticle) {
                // C39: never auto-overwrite. The user chooses.
                conflict = .stale
            } else {
                errorMessage = error.message
            }
            return false
        } catch {
            errorMessage = "Couldn't save this article."
            return false
        }
    }

    // MARK: - Conflict resolution (C39)

    /// The local edits as JSON, for "Copy my changes" — so an admin whose
    /// work is about to be discarded can keep it.
    ///
    /// Carries the title, status, and category as well as the blocks: the
    /// button promises to copy *your changes*, and the reload that follows
    /// discards all four. Copying only the blocks quietly loses a retitling.
    func changesJSONForPasteboard() -> String? {
        struct Snapshot: Encodable {
            let title: String
            let status: ArticleStatus
            let categoryId: String
            let blocks: [Block]
        }
        let encoder = APICoding.makeEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let snapshot = Snapshot(
            title: title, status: status, categoryId: categoryID, blocks: blocks
        )
        guard let data = try? encoder.encode(snapshot) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Discards local edits and reloads the server's version.
    func reloadAfterConflict() async {
        conflict = nil
        await load()
    }

    func dismissConflict() {
        conflict = nil
    }
}
