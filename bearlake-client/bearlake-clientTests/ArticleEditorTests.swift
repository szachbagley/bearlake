//
//  ArticleEditorTests.swift
//  bearlake-clientTests
//

import Foundation
import UIKit
import Testing
@testable import bearlake_client

private let decoder = APICoding.makeDecoder()
private let encoder = APICoding.makeEncoder()

private func parsed(_ data: Data) throws -> JSONValue {
    try decoder.decode(JSONValue.self, from: data)
}

/// Records what was PATCHed so assertions are about the wire.
private actor EditorAPI: BearLakeAPI {
    var article: InfoArticle
    private(set) var patches: [UpdateArticleRequest] = []
    var nextError: APIError?
    /// When set, the next PATCH answers 409.
    var conflictOnNextSave = false

    init(article: InfoArticle) { self.article = article }
    func setNextError(_ error: APIError?) { nextError = error }
    func setConflict(_ value: Bool) { conflictOnNextSave = value }
    func setArticle(_ value: InfoArticle) { article = value }

    func getArticle(id: String) async throws -> InfoArticle {
        if let nextError { self.nextError = nil; throw nextError }
        return article
    }

    func updateArticle(id: String, _ body: UpdateArticleRequest) async throws -> InfoArticle {
        patches.append(body)
        if conflictOnNextSave {
            conflictOnNextSave = false
            throw APIError(
                status: 409, code: "STALE_ARTICLE",
                message: "This article changed since you opened it."
            )
        }
        if let nextError { self.nextError = nil; throw nextError }
        let updated = InfoArticle(
            id: article.id, categoryId: body.categoryId ?? article.categoryId,
            title: body.title ?? article.title,
            blocks: body.blocks ?? article.blocks,
            schemaVersion: article.schemaVersion,
            status: body.status ?? article.status,
            sortOrder: article.sortOrder, createdBy: article.createdBy,
            createdAt: article.createdAt,
            updatedAt: article.updatedAt.addingTimeInterval(60)
        )
        article = updated
        return updated
    }

    func presignUpload(_ body: PresignUploadRequest) async throws -> PresignUploadResponse {
        if let nextError { self.nextError = nil; throw nextError }
        return PresignUploadResponse(
            key: "articles/\(body.articleId)/33333333-3333-4333-8333-333333333333",
            uploadUrl: "https://bucket.s3.amazonaws.com/signed?X-Amz-Expires=900"
        )
    }

    func login(email: String, password: String) async throws -> SessionResult { throw APIError.notFound }
    func logout() async throws {}
    func changePassword(currentPassword: String, newPassword: String) async throws -> SessionResult { throw APIError.notFound }
    func me() async throws -> PublicUser { .fixture() }
    func listEvents(start: Date, end: Date) async throws -> [CalendarEvent] { [] }
    func createEvent(_ body: CreateEventRequest) async throws -> CalendarEvent { throw APIError.notFound }
    func getEvent(id: String) async throws -> CalendarEvent { throw APIError.notFound }
    func updateEvent(id: String, _ body: UpdateEventRequest) async throws -> CalendarEvent { throw APIError.notFound }
    func deleteEvent(id: String) async throws {}
    func listAnnouncements(limit: Int?, cursor: String?) async throws -> AnnouncementPage { .init(items: [], nextCursor: nil) }
    func createAnnouncement(body: String) async throws -> Announcement { .fixture() }
    func updateAnnouncement(id: String, body: String) async throws -> Announcement { .fixture() }
    func deleteAnnouncement(id: String) async throws {}
    func listQuickTips() async throws -> [QuickTip] { [] }
    func createQuickTip(_ body: CreateQuickTipRequest) async throws -> QuickTip { throw APIError.notFound }
    func updateQuickTip(id: String, _ body: UpdateQuickTipRequest) async throws -> QuickTip { throw APIError.notFound }
    func deleteQuickTip(id: String) async throws {}
    func listCategories() async throws -> [InfoCategory] { [] }
    func createCategory(_ body: CreateCategoryRequest) async throws -> InfoCategory { throw APIError.notFound }
    func updateCategory(id: String, _ body: UpdateCategoryRequest) async throws -> InfoCategory { throw APIError.notFound }
    func deleteCategory(id: String) async throws {}
    func listArticles(categoryID: String) async throws -> [ArticleSummary] { [] }
    func createArticle(_ body: CreateArticleRequest) async throws -> InfoArticle { throw APIError.notFound }
    func deleteArticle(id: String) async throws {}
}

@MainActor
private func makeEditor(blocks: [Block] = []) async -> (ArticleEditorViewModel, EditorAPI) {
    let article = InfoArticle.fixture(id: "a1", title: "Monitoring chemicals", blocks: blocks)
    let api = EditorAPI(article: article)
    let model = ArticleEditorViewModel(articleID: "a1", api: api)
    await model.load()
    return (model, api)
}

// MARK: - §11.5 round-tripping, the highest-risk requirement

@MainActor
struct BlockRoundTripTests {
    private let futureBlockJSON = """
    {"id":"cccccccc-0000-4000-8000-000000000001","type":"table",
     "columns":["Item","Where"],"rows":[["Life jackets","Boathouse"]],
     "meta":{"width":3,"compact":true,"note":null}}
    """

    /// The requirement: an unknown block survives load → unrelated edit →
    /// save **structurally identical**. Compared as parsed JSON, never as
    /// strings, because key order differs between Swift and TypeScript (C32).
    @Test("an unknown block round-trips unchanged through an unrelated edit")
    func unknownBlockSurvivesAnEdit() async throws {
        let original = try decoder.decode(Block.self, from: Data(futureBlockJSON.utf8))
        let (model, api) = await makeEditor(blocks: [
            .paragraph(id: "bbbbbbbb-0000-4000-8000-000000000001", text: "Before"),
            original,
        ])

        // An edit that has nothing to do with the unknown block.
        model.setTitle("A different title")
        model.replace(.paragraph(id: "bbbbbbbb-0000-4000-8000-000000000001", text: "After"))
        #expect(await model.save())

        let patch = try #require(await api.patches.first)
        let sent = try #require(patch.blocks)
        #expect(sent.count == 2, "the unknown block is still there")

        let sentUnknown = try #require(sent.last)
        #expect(sentUnknown.isUnknown)
        #expect(
            try parsed(try encoder.encode(sentUnknown)) == (try parsed(Data(futureBlockJSON.utf8))),
            "structurally identical, including the nested bool and explicit null"
        )
    }

    @Test("an unknown block survives being reordered")
    func unknownBlockSurvivesReorder() async throws {
        let original = try decoder.decode(Block.self, from: Data(futureBlockJSON.utf8))
        let (model, api) = await makeEditor(blocks: [
            .paragraph(id: "bbbbbbbb-0000-4000-8000-000000000001", text: "First"),
            original,
        ])

        model.move(from: IndexSet(integer: 1), to: 0)
        #expect(model.blocks.first?.isUnknown == true, "it moved")
        #expect(await model.save())

        let sent = try #require(await api.patches.first?.blocks)
        #expect(
            try parsed(try encoder.encode(sent[0])) == (try parsed(Data(futureBlockJSON.utf8))),
            "still byte-for-byte equivalent after moving"
        )
    }

    /// An unknown block has no rules this build knows, so it must never be
    /// validated — otherwise a future block type would make the article
    /// unsaveable on an older phone.
    @Test("an unknown block never blocks saving")
    func unknownBlockNeverInvalid() async throws {
        let original = try decoder.decode(Block.self, from: Data(futureBlockJSON.utf8))
        #expect(ArticleEditorViewModel.problem(with: original) == nil)
    }
}

// MARK: - Payload shape (C34)

@MainActor
struct EditorPayloadTests {
    /// C34, asserted on the actual bytes. The presigned URL rotates every read
    /// and expires; persisting it would bake in an expiry and a bucket name.
    @Test("no write payload contains a presigned url")
    func noURLInWritePayload() async throws {
        let withURL = try decoder.decode(Block.self, from: Data("""
        {"id":"dddddddd-0000-4000-8000-000000000001","type":"image",
         "key":"articles/9f9a1eb9-0000-4000-8000-000000000001/d532caad-0000-4000-8000-000000000002",
         "caption":"The dock",
         "url":"https://bucket.s3.amazonaws.com/signed?X-Amz-Expires=900&X-Amz-Signature=abc"}
        """.utf8))
        let (model, api) = await makeEditor(blocks: [withURL])

        model.setTitle("Edited")
        #expect(await model.save())

        let patch = try #require(await api.patches.first)
        let json = String(decoding: try encoder.encode(patch), as: UTF8.self)
        #expect(json.contains("X-Amz") == false)
        #expect(json.contains("\"url\"") == false)
        #expect(json.contains("d532caad"), "but the key is still there")
    }

    @Test("the patch always carries the loaded updatedAt")
    func patchCarriesLockToken() async throws {
        let (model, api) = await makeEditor(blocks: [.paragraph(id: "b1", text: "Text")])
        model.setTitle("Edited")
        #expect(await model.save())

        let patch = try #require(await api.patches.first)
        #expect(patch.updatedAt == InfoArticle.fixture().updatedAt)
        let fields = try #require(
            try JSONSerialization.jsonObject(with: try encoder.encode(patch)) as? [String: Any]
        )
        #expect(fields["updatedAt"] != nil)
        #expect(fields["schemaVersion"] == nil, "the server stamps that; sending it is a 400")
    }
}

// MARK: - Reordering and deleting

@MainActor
struct BlockReorderTests {
    private func paragraphs(_ ids: [String]) -> [Block] {
        ids.map { .paragraph(id: $0, text: "Text \($0)") }
    }

    @Test("moving a block reorders it and preserves every id")
    func movePreservesIDs() async throws {
        let (model, _) = await makeEditor(blocks: paragraphs(["a", "b", "c", "d"]))

        model.move(from: IndexSet(integer: 0), to: 3)
        #expect(model.blocks.map(\.id) == ["b", "c", "a", "d"])
        #expect(Set(model.blocks.map(\.id)) == ["a", "b", "c", "d"], "nothing lost or invented")
    }

    @Test("moving upward lands where SwiftUI would put it")
    func moveUpward() async throws {
        let (model, _) = await makeEditor(blocks: paragraphs(["a", "b", "c", "d"]))
        model.move(from: IndexSet(integer: 3), to: 1)
        #expect(model.blocks.map(\.id) == ["a", "d", "b", "c"])
    }

    @Test("moving several at once keeps their relative order")
    func moveMultiple() async throws {
        let (model, _) = await makeEditor(blocks: paragraphs(["a", "b", "c", "d", "e"]))
        model.move(from: IndexSet([0, 1]), to: 4)
        #expect(model.blocks.map(\.id) == ["c", "d", "a", "b", "e"])
    }

    @Test("a move to the same place changes nothing and does not dirty the editor")
    func noOpMove() async throws {
        let (model, _) = await makeEditor(blocks: paragraphs(["a", "b", "c"]))
        model.move(from: IndexSet(integer: 1), to: 1)
        #expect(model.blocks.map(\.id) == ["a", "b", "c"])
        #expect(model.isDirty == false)
    }

    @Test("deleting removes exactly the chosen rows")
    func deleteRemovesRows() async throws {
        let (model, _) = await makeEditor(blocks: paragraphs(["a", "b", "c", "d"]))
        model.delete(at: IndexSet([1, 3]))
        #expect(model.blocks.map(\.id) == ["a", "c"])
    }

    @Test("an out-of-range index is ignored rather than crashing")
    func ignoresBadIndices() async throws {
        let (model, _) = await makeEditor(blocks: paragraphs(["a", "b"]))
        model.delete(at: IndexSet(integer: 99))
        model.move(from: IndexSet(integer: 42), to: 0)
        #expect(model.blocks.map(\.id) == ["a", "b"])
    }
}

// MARK: - New blocks

@MainActor
struct NewBlockTests {
    /// C33 — ids are the identity for reorder, edit, and List diffing, and
    /// the server validates lowercase UUIDs.
    @Test("every appended block gets a fresh lowercase UUID")
    func appendedIDsAreUniqueUUIDs() async throws {
        let (model, _) = await makeEditor()
        for _ in 0..<10 {
            for kind in ArticleEditorViewModel.NewBlockKind.allCases { model.append(kind) }
        }

        let ids = model.blocks.map(\.id)
        #expect(ids.count == 40)
        #expect(Set(ids).count == 40, "no duplicates")
        for id in ids {
            #expect(id == id.lowercased())
            #expect(UUID(uuidString: id) != nil)
        }
    }

    @Test("adding one of each type produces something the server would accept")
    func oneOfEachIsValid() async throws {
        let (model, api) = await makeEditor()
        model.append(.heading)
        model.append(.paragraph)
        model.append(.bullets)
        model.append(.video)

        // Fresh blocks start empty, which is deliberately invalid — the
        // editor should not let an empty heading reach the server.
        #expect(model.validationProblem != nil)

        model.replace(.heading(id: model.blocks[0].id, text: "Pool"))
        model.replace(.paragraph(id: model.blocks[1].id, text: "Check weekly."))
        model.replace(.bullets(id: model.blocks[2].id, items: ["Test strips"]))
        model.replace(.video(id: model.blocks[3].id, videoId: "dQw4w9WgXcQ", caption: nil))

        #expect(model.validationProblem == nil)
        #expect(await model.save())
        #expect(await api.patches.count == 1)
    }
}

// MARK: - Validation

@MainActor
struct EditorValidationTests {
    @Test("an empty block of any kind blocks saving")
    func emptyBlocksInvalid() {
        #expect(ArticleEditorViewModel.problem(with: .heading(id: "1", text: "  ")) != nil)
        #expect(ArticleEditorViewModel.problem(with: .paragraph(id: "1", text: "")) != nil)
        #expect(ArticleEditorViewModel.problem(with: .bullets(id: "1", items: [])) != nil)
        #expect(ArticleEditorViewModel.problem(with: .bullets(id: "1", items: ["ok", " "])) != nil)
    }

    @Test("the caps match the server's")
    func capsMatchServer() {
        let longHeading = String(repeating: "a", count: Limits.headingTextMax + 1)
        #expect(ArticleEditorViewModel.problem(with: .heading(id: "1", text: longHeading)) != nil)

        let longParagraph = String(repeating: "a", count: Limits.paragraphTextMax + 1)
        #expect(ArticleEditorViewModel.problem(with: .paragraph(id: "1", text: longParagraph)) != nil)

        let tooManyBullets = Array(repeating: "x", count: Limits.bulletItemsMax + 1)
        #expect(ArticleEditorViewModel.problem(with: .bullets(id: "1", items: tooManyBullets)) != nil)

        let longCaption = String(repeating: "a", count: Limits.blockCaptionMax + 1)
        #expect(ArticleEditorViewModel.problem(
            with: .image(id: "1", key: "articles/x/y", caption: longCaption, url: nil)) != nil)
    }

    @Test("a video needs a real YouTube id")
    func videoNeedsValidID() {
        #expect(ArticleEditorViewModel.problem(with: .video(id: "1", videoId: "", caption: nil)) != nil)
        #expect(ArticleEditorViewModel.problem(with: .video(id: "1", videoId: "nope", caption: nil)) != nil)
        #expect(ArticleEditorViewModel.problem(
            with: .video(id: "1", videoId: "dQw4w9WgXcQ", caption: nil)) == nil)
    }

    @Test("an invalid article never reaches the network")
    func invalidNeverSaves() async throws {
        let (model, api) = await makeEditor(blocks: [.paragraph(id: "b1", text: "Fine")])
        model.setTitle("   ")
        #expect(await model.save() == false)
        #expect(await api.patches.isEmpty)
    }
}

// MARK: - Conflict (C39)

@MainActor
struct StaleArticleTests {
    /// The one real data-loss path in this project. A 409 must never
    /// auto-overwrite.
    @Test("a 409 raises the conflict prompt and does not overwrite")
    func conflictRaisesPrompt() async throws {
        let (model, api) = await makeEditor(blocks: [.paragraph(id: "b1", text: "Mine")])
        await api.setConflict(true)

        model.replace(.paragraph(id: "b1", text: "My local edit"))
        #expect(await model.save() == false)

        #expect(model.conflict == .stale)
        #expect(model.errorMessage == nil, "the conflict prompt replaces the generic alert")
        #expect(await api.patches.count == 1, "it tried exactly once and stopped")
        #expect(model.blocks.first == .paragraph(id: "b1", text: "My local edit"),
                "local edits are still there for the user to copy")
    }

    @Test("Copy my changes produces the local blocks as JSON")
    func copyProducesJSON() async throws {
        let (model, api) = await makeEditor(blocks: [.paragraph(id: "b1", text: "Mine")])
        await api.setConflict(true)
        model.replace(.paragraph(id: "b1", text: "Worth keeping"))
        _ = await model.save()

        let json = try #require(model.changesJSONForPasteboard())
        #expect(json.contains("Worth keeping"))
        // Parseable, so it can be pasted somewhere useful.
        struct Snapshot: Decodable {
            let title: String
            let status: ArticleStatus
            let categoryId: String
            let blocks: [Block]
        }
        let restored = try decoder.decode(Snapshot.self, from: Data(json.utf8))
        #expect(restored.blocks == model.blocks)
    }

    /// The button says it copies *your changes*, and the reload that follows
    /// discards the title and status too — so copying only blocks silently
    /// loses a retitling.
    @Test("Copy my changes carries the title, status, and category too")
    func copyCarriesMetadata() async throws {
        let (model, api) = await makeEditor(blocks: [.paragraph(id: "b1", text: "Mine")])
        await api.setConflict(true)
        model.setTitle("My renamed article")
        model.setStatus(.published)
        _ = await model.save()

        let json = try #require(model.changesJSONForPasteboard())
        #expect(json.contains("My renamed article"))
        #expect(json.contains("published"))
    }

    @Test("Reload discards local edits and takes the server's version")
    func reloadTakesServerVersion() async throws {
        let (model, api) = await makeEditor(blocks: [.paragraph(id: "b1", text: "Mine")])
        await api.setConflict(true)
        model.replace(.paragraph(id: "b1", text: "My local edit"))
        _ = await model.save()
        #expect(model.conflict == .stale)

        // Someone else's version is what the server now holds.
        await api.setArticle(InfoArticle.fixture(
            id: "a1", title: "Theirs",
            blocks: [.paragraph(id: "b1", text: "Their edit")]
        ))
        await model.reloadAfterConflict()

        #expect(model.conflict == nil)
        #expect(model.title == "Theirs")
        #expect(model.blocks.first == .paragraph(id: "b1", text: "Their edit"))
        #expect(model.isDirty == false)
    }

    @Test("a non-conflict failure shows an alert rather than the conflict prompt")
    func otherFailuresAreAlerts() async throws {
        let (model, api) = await makeEditor(blocks: [.paragraph(id: "b1", text: "Mine")])
        await api.setNextError(APIError(
            status: 403, code: "FORBIDDEN", message: "Only an admin can edit articles."
        ))
        model.setTitle("Edited")

        #expect(await model.save() == false)
        #expect(model.conflict == nil)
        #expect(model.errorMessage == "Only an admin can edit articles.")
    }
}

// MARK: - Dirty tracking (step 8)

@MainActor
struct DirtyTrackingTests {
    @Test("a freshly loaded article is clean")
    func loadedIsClean() async throws {
        let (model, _) = await makeEditor(blocks: [.paragraph(id: "b1", text: "Text")])
        #expect(model.isDirty == false)
        #expect(model.canSave == false, "nothing to save")
    }

    @Test("each kind of edit dirties the editor")
    func editsDirty() async throws {
        let (model, _) = await makeEditor(blocks: [.paragraph(id: "b1", text: "Text")])
        model.setTitle("New")
        #expect(model.isDirty)

        let (model2, _) = await makeEditor(blocks: [.paragraph(id: "b1", text: "Text")])
        // The fixture loads as .published, so toggling to .draft is the real
        // change here — setting .published again is correctly a no-op.
        #expect(model2.status == .published)
        model2.setStatus(.draft)
        #expect(model2.isDirty)

        let (model3, _) = await makeEditor(blocks: [.paragraph(id: "b1", text: "Text")])
        model3.replace(.paragraph(id: "b1", text: "Changed"))
        #expect(model3.isDirty)
    }

    @Test("setting the same value again does not dirty the editor")
    func noOpEditsAreClean() async throws {
        let (model, _) = await makeEditor(blocks: [.paragraph(id: "b1", text: "Text")])
        model.setTitle(model.title)
        model.setStatus(model.status)
        model.replace(.paragraph(id: "b1", text: "Text"))
        #expect(model.isDirty == false)
    }

    @Test("a successful save clears the dirty flag and takes the new token")
    func saveClearsDirty() async throws {
        let (model, _) = await makeEditor(blocks: [.paragraph(id: "b1", text: "Text")])
        let before = model.loadedUpdatedAt
        model.setTitle("Edited")
        #expect(await model.save())

        #expect(model.isDirty == false)
        #expect(model.loadedUpdatedAt != before, "the next save uses the fresh token")
    }
}

// MARK: - Review follow-ups: save gating and error surfacing

@MainActor
struct EditorSaveGuardTests {
    /// Saving mid-upload dismisses the editor; when the PUT lands, addPhoto
    /// appends the block to a ViewModel nobody is showing. The photo is lost
    /// and the S3 object is orphaned.
    @Test("Save is disabled while a photo is uploading")
    func cannotSaveDuringUpload() async throws {
        let article = InfoArticle.fixture(id: "a1", blocks: [])
        let api = EditorAPI(article: article)
        // Blocks in the PUT so the upload is observably in flight.
        let gate = UploadGate()
        let uploader = ImageUploader(api: api) { _, _, onProgress in
            onProgress(0.5)
            await gate.wait()
            return 200
        }
        let model = ArticleEditorViewModel(articleID: "a1", api: api, uploader: uploader)
        await model.load()
        model.setTitle("Edited")
        #expect(model.canSave, "dirty and valid, so it would save right now")

        let upload = Task { await model.addPhoto(makeTestPhoto()) }
        while model.uploadProgress == nil { await Task.yield() }

        #expect(model.canSave == false, "an in-flight upload blocks the save")

        await gate.open()
        await upload.value
        #expect(model.canSave, "and it comes back once the upload finishes")
    }

    /// A load that failed leaves no optimistic-lock token. Returning quietly
    /// made Save do nothing at all — no alert, no dismissal.
    @Test("saving without a load token surfaces a message instead of failing silently")
    func saveWithoutTokenExplainsItself() async throws {
        let api = EditorAPI(article: InfoArticle.fixture(id: "a1", blocks: []))
        await api.setNextError(APIError(
            status: 500, code: "INTERNAL", message: "Something went wrong."
        ))
        let model = ArticleEditorViewModel(articleID: "a1", api: api)
        await model.load()
        #expect(model.loadedUpdatedAt == nil, "the load failed, so there is no token")

        model.errorMessage = nil
        model.setTitle("A title good enough to pass validation")

        #expect(await model.save() == false)
        #expect(model.errorMessage != nil, "every failure surfaces something actionable")
    }
}

/// Captures the progress callback so a test can fire it late, reproducing
/// the real ordering hazard: the callback hops to the MainActor as its own
/// Task and is not ordered against the upload's resumption.
private actor LateProgress {
    private var callback: (@Sendable (Double) -> Void)?
    func capture(_ value: @escaping @Sendable (Double) -> Void) { callback = value }
    func fireLate(_ value: Double) { callback?(value) }
}

@MainActor
struct EditorUploadProgressTests {
    /// A stranded `uploadProgress` leaves a phantom progress row on screen
    /// and permanently disables the photo picker for the rest of the session.
    @Test("a progress callback arriving after the upload cannot strand the picker")
    func lateProgressCallbackIsIgnored() async throws {
        let api = EditorAPI(article: InfoArticle.fixture(id: "a1", blocks: []))
        let late = LateProgress()
        let uploader = ImageUploader(api: api) { _, _, onProgress in
            await late.capture(onProgress)
            return 200
        }
        let model = ArticleEditorViewModel(articleID: "a1", api: api, uploader: uploader)
        await model.load()

        await model.addPhoto(makeTestPhoto())
        #expect(model.uploadProgress == nil, "cleared when the upload finished")

        // The stale callback lands now, after cleanup.
        await late.fireLate(1.0)
        for _ in 0..<10 { await Task.yield() }

        #expect(model.uploadProgress == nil, "and a late callback does not revive it")
    }

    /// A freshly added photo has a key but no presigned URL until the article
    /// is saved and read back, so without seeding there is nothing to render
    /// and the block shows "Photo unavailable" in its own editor.
    @Test("a successful upload seeds the shared image cache under its key")
    func uploadSeedsCache() async throws {
        let api = EditorAPI(article: InfoArticle.fixture(id: "a1", blocks: []))
        let uploader = ImageUploader(api: api) { _, _, onProgress in
            onProgress(1.0)
            return 200
        }
        let cache = ImageCache()
        let model = ArticleEditorViewModel(
            articleID: "a1", api: api, uploader: uploader, cache: cache
        )
        await model.load()

        await model.addPhoto(makeTestPhoto())

        guard case .image(_, let key, _, let url) = model.blocks[0] else {
            Issue.record("expected an image block"); return
        }
        #expect(url == nil, "still no presigned url — the block holds only the key")
        #expect(await cache.cachedImage(forKey: key) != nil,
                "so the preview comes from the cache we just seeded")
    }
}

/// Lets a test hold a stubbed PUT open.
private actor UploadGate {
    private var continuations: [CheckedContinuation<Void, Never>] = []
    private var isOpen = false

    func wait() async {
        if isOpen { return }
        await withCheckedContinuation { continuations.append($0) }
    }

    func open() {
        isOpen = true
        let pending = continuations
        continuations = []
        for continuation in pending { continuation.resume() }
    }
}

// MARK: - Photos

@MainActor
struct EditorPhotoTests {
    @Test("a successful upload appends an image block holding the key, not a url")
    func uploadAppendsKeyOnly() async throws {
        let article = InfoArticle.fixture(id: "a1", blocks: [])
        let api = EditorAPI(article: article)
        let uploader = ImageUploader(api: api) { _, _, onProgress in
            onProgress(1.0)
            return 200
        }
        let model = ArticleEditorViewModel(articleID: "a1", api: api, uploader: uploader)
        await model.load()

        await model.addPhoto(makeTestPhoto())

        #expect(model.blocks.count == 1)
        guard case .image(_, let key, _, let url) = model.blocks[0] else {
            Issue.record("expected an image block"); return
        }
        #expect(key.hasPrefix("articles/a1/"))
        #expect(url == nil, "there is no presigned url yet; the next load supplies one")
        #expect(model.isDirty)
        #expect(model.uploadProgress == nil, "progress is cleared when it finishes")
    }

    @Test("a rejected photo surfaces a message and adds no block")
    func rejectedPhotoAddsNothing() async throws {
        let article = InfoArticle.fixture(id: "a1", blocks: [])
        let api = EditorAPI(article: article)
        let model = ArticleEditorViewModel(articleID: "a1", api: api)
        await model.load()

        await model.addPhoto(Data("not a photo".utf8))

        #expect(model.blocks.isEmpty)
        #expect(model.errorMessage != nil)
        #expect(model.isDirty == false)
    }
}

private func makeTestPhoto() -> Data {
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: 400, height: 300), format: format)
    return renderer.image { context in
        UIColor.systemIndigo.setFill()
        context.fill(CGRect(x: 0, y: 0, width: 400, height: 300))
    }.jpegData(compressionQuality: 0.9) ?? Data()
}
