//
//  AnnouncementsViewModelTests.swift
//  bearlake-clientTests
//

import Foundation
import Testing
@testable import bearlake_client

/// A double that serves fixed pages, so cursor handling can be driven exactly.
private actor PagingAPI: BearLakeAPI {
    var pages: [(items: [Announcement], next: String?)] = []
    private(set) var requestedCursors: [String?] = []
    private(set) var deleted: [String] = []
    var nextError: APIError?

    init(pages: [(items: [Announcement], next: String?)]) { self.pages = pages }

    func listAnnouncements(limit: Int?, cursor: String?) async throws -> AnnouncementPage {
        requestedCursors.append(cursor)
        if let nextError { self.nextError = nil; throw nextError }
        let index = cursor.flatMap(Int.init) ?? 0
        guard index < pages.count else { return AnnouncementPage(items: [], nextCursor: nil) }
        let page = pages[index]
        return AnnouncementPage(items: page.items, nextCursor: page.next)
    }

    func deleteAnnouncement(id: String) async throws {
        if let nextError { self.nextError = nil; throw nextError }
        deleted.append(id)
    }

    func setNextError(_ error: APIError?) { nextError = error }

    // Unused by these tests.
    func login(email: String, password: String) async throws -> SessionResult { throw APIError.notFound }
    func logout() async throws {}
    func changePassword(currentPassword: String, newPassword: String) async throws -> SessionResult { throw APIError.notFound }
    func me() async throws -> PublicUser { .fixture() }
    func listEvents(start: Date, end: Date) async throws -> [CalendarEvent] { [] }
    func createEvent(_ body: CreateEventRequest) async throws -> CalendarEvent { throw APIError.notFound }
    func getEvent(id: String) async throws -> CalendarEvent { throw APIError.notFound }
    func updateEvent(id: String, _ body: UpdateEventRequest) async throws -> CalendarEvent { throw APIError.notFound }
    func deleteEvent(id: String) async throws {}
    func createAnnouncement(body: String) async throws -> Announcement { .fixture(body: body) }
    func updateAnnouncement(id: String, body: String) async throws -> Announcement { .fixture(id: id, body: body) }
    func listQuickTips() async throws -> [QuickTip] { [] }
    func createQuickTip(_ body: CreateQuickTipRequest) async throws -> QuickTip { throw APIError.notFound }
    func updateQuickTip(id: String, _ body: UpdateQuickTipRequest) async throws -> QuickTip { throw APIError.notFound }
    func deleteQuickTip(id: String) async throws {}
    func listCategories() async throws -> [InfoCategory] { [] }
    func createCategory(_ body: CreateCategoryRequest) async throws -> InfoCategory { throw APIError.notFound }
    func updateCategory(id: String, _ body: UpdateCategoryRequest) async throws -> InfoCategory { throw APIError.notFound }
    func deleteCategory(id: String) async throws {}
    func listArticles(categoryID: String) async throws -> [ArticleSummary] { [] }
    func getArticle(id: String) async throws -> InfoArticle { throw APIError.notFound }
    func createArticle(_ body: CreateArticleRequest) async throws -> InfoArticle { throw APIError.notFound }
    func updateArticle(id: String, _ body: UpdateArticleRequest) async throws -> InfoArticle { throw APIError.notFound }
    func deleteArticle(id: String) async throws {}
    func presignUpload(_ body: PresignUploadRequest) async throws -> PresignUploadResponse { throw APIError.notFound }
}

private func page(_ ids: [String], next: String?) -> (items: [Announcement], next: String?) {
    (ids.map { .fixture(id: $0, body: "Body \($0)") }, next)
}

@MainActor
struct PaginationTests {
    @Test("the first page loads and offers more")
    func loadsFirstPage() async throws {
        let api = PagingAPI(pages: [page(["a", "b"], next: "1"), page(["c"], next: nil)])
        let model = AnnouncementsViewModel(api: api)

        await model.load()

        #expect(model.announcements.map(\.id) == ["a", "b"])
        #expect(model.nextCursor == "1")
        #expect(model.canLoadMore)
    }

    @Test("loading more appends and then stops at the end")
    func appendsAndStops() async throws {
        let api = PagingAPI(pages: [page(["a", "b"], next: "1"), page(["c"], next: nil)])
        let model = AnnouncementsViewModel(api: api)

        await model.load()
        await model.loadMore()

        #expect(model.announcements.map(\.id) == ["a", "b", "c"])
        #expect(model.nextCursor == nil)
        #expect(model.canLoadMore == false)

        // Asking again does nothing rather than re-fetching the last page.
        await model.loadMore()
        #expect(await api.requestedCursors == [nil, "1"])
    }

    /// The cursor is opaque and the ordering timestamp is not guaranteed
    /// unique, so a row sitting on a page boundary can legitimately return
    /// twice. Duplicated ids would crash a ForEach keyed on id, not merely
    /// look wrong.
    @Test("a row repeated across a page boundary is not duplicated")
    func deduplicatesAcrossPages() async throws {
        let api = PagingAPI(pages: [
            page(["a", "b"], next: "1"),
            page(["b", "c"], next: nil),
        ])
        let model = AnnouncementsViewModel(api: api)

        await model.load()
        await model.loadMore()

        #expect(model.announcements.map(\.id) == ["a", "b", "c"])
        #expect(Set(model.announcements.map(\.id)).count == model.announcements.count)
    }

    @Test("a refresh resets rather than appending")
    func refreshResets() async throws {
        let api = PagingAPI(pages: [page(["a", "b"], next: "1"), page(["c"], next: nil)])
        let model = AnnouncementsViewModel(api: api)

        await model.load()
        await model.loadMore()
        #expect(model.announcements.count == 3)

        await model.load()
        #expect(model.announcements.map(\.id) == ["a", "b"], "a refresh starts over")
        #expect(model.nextCursor == "1")
    }

    @Test("loadMore does nothing when there is no cursor")
    func noCursorNoRequest() async throws {
        let api = PagingAPI(pages: [page(["a"], next: nil)])
        let model = AnnouncementsViewModel(api: api)

        await model.load()
        await model.loadMore()
        #expect(await api.requestedCursors == [nil], "no second request")
    }

    @Test("a failure while paging keeps what is already loaded")
    func pagingFailureKeepsList() async throws {
        let api = PagingAPI(pages: [page(["a", "b"], next: "1"), page(["c"], next: nil)])
        let model = AnnouncementsViewModel(api: api)
        await model.load()

        await api.setNextError(APIError(status: 500, code: "INTERNAL", message: "Server error."))
        await model.loadMore()

        #expect(model.announcements.map(\.id) == ["a", "b"], "the loaded page survives")
        #expect(model.errorMessage == "Server error.")
        #expect(model.nextCursor == "1", "still resumable")
    }
}

@MainActor
struct AnnouncementMutationTests {
    @Test("deleting removes the row")
    func deleteRemovesRow() async throws {
        let api = PagingAPI(pages: [page(["a", "b"], next: nil)])
        let model = AnnouncementsViewModel(api: api)
        await model.load()

        await model.delete(model.announcements[0])

        #expect(model.announcements.map(\.id) == ["b"])
        #expect(await api.deleted == ["a"])
    }

    /// A member who somehow reached this path gets the server's explanation
    /// rather than a swallowed failure — the hidden button is an affordance,
    /// not the boundary (C48).
    @Test("a FORBIDDEN delete surfaces the server's message and keeps the row")
    func forbiddenDeleteSurfaces() async throws {
        let api = PagingAPI(pages: [page(["a"], next: nil)])
        let model = AnnouncementsViewModel(api: api)
        await model.load()

        await api.setNextError(APIError(
            status: 403, code: "FORBIDDEN", message: "Only an admin can delete announcements."
        ))
        await model.delete(model.announcements[0])

        #expect(model.announcements.map(\.id) == ["a"], "the row stays")
        #expect(model.errorMessage == "Only an admin can delete announcements.")
    }

    @Test("an edit replaces in place; a create goes to the top")
    func mergeBehaviour() async throws {
        let api = PagingAPI(pages: [page(["a", "b"], next: nil)])
        let model = AnnouncementsViewModel(api: api)
        await model.load()

        model.merge(.fixture(id: "b", body: "Edited"))
        #expect(model.announcements.map(\.id) == ["a", "b"])
        #expect(model.announcements[1].body == "Edited")

        model.merge(.fixture(id: "new", body: "Fresh"))
        #expect(model.announcements.map(\.id) == ["new", "a", "b"])
    }
}

/// The body cap is enforced in the editor before a request is made; these
/// pin the values the UI checks against.
struct AnnouncementLimitTests {
    @Test("the body cap matches the server")
    func bodyCap() {
        #expect(Limits.announcementBodyMax == 5_000)
        #expect(Limits.announcementBodyMin == 1)
    }

    @Test("the default page size is within the server's allowed range")
    func pageSize() {
        #expect(Limits.announcementListLimitDefault <= Limits.announcementListLimitMax)
        #expect(Limits.announcementListLimitDefault >= Limits.announcementListLimitMin)
    }
}

@MainActor
struct AnnouncementValidationTests {
    /// The check that keeps an over-length body off the network.
    @Test("an over-length body is rejected before any request")
    func rejectsOverLength() {
        let tooLong = String(repeating: "a", count: Limits.announcementBodyMax + 1)
        #expect(AnnouncementsViewModel.validationProblem(body: tooLong) != nil)

        let exact = String(repeating: "a", count: Limits.announcementBodyMax)
        #expect(AnnouncementsViewModel.validationProblem(body: exact) == nil)
    }

    @Test("an empty or whitespace-only body is rejected")
    func rejectsEmpty() {
        #expect(AnnouncementsViewModel.validationProblem(body: "") != nil)
        #expect(AnnouncementsViewModel.validationProblem(body: "   \n  ") != nil)
        #expect(AnnouncementsViewModel.validationProblem(body: "Marina code is 0000") == nil)
    }
}

// MARK: - The editor (Phase 11, step 1)

/// These exist because the editor's save path used to live inside a `View`,
/// where none of it could be reached from a test.
@MainActor
struct AnnouncementEditorViewModelTests {
    @Test("creating posts the trimmed body")
    func createTrims() async throws {
        let api = FakeAPI()
        let model = AnnouncementEditorViewModel(api: api, existing: nil)
        model.setText("  Gate code is 4417.  ")

        let saved = try #require(await model.save())
        #expect(saved.body == "Gate code is 4417.")
        #expect(model.errorMessage == nil)
    }

    @Test("editing updates the existing announcement")
    func editUpdates() async throws {
        let api = FakeAPI()
        let existing = Announcement.fixture(id: "a1", body: "Original")
        await api.seed(announcements: [existing])
        let model = AnnouncementEditorViewModel(api: api, existing: existing)
        #expect(model.isEditing)
        #expect(model.hasChanges == false, "untouched, so nothing to discard")

        model.setText("Corrected")
        #expect(model.hasChanges)

        let saved = try #require(await model.save())
        #expect(saved.body == "Corrected")
    }

    @Test("an empty or over-long body cannot be saved")
    func validationBlocksSave() {
        let api = FakeAPI()
        let model = AnnouncementEditorViewModel(api: api, existing: nil)
        #expect(model.canSave == false, "empty")

        model.setText("   ")
        #expect(model.canSave == false, "whitespace only")

        model.setText(String(repeating: "x", count: Limits.announcementBodyMax + 1))
        #expect(model.canSave == false)
        #expect(model.isOverLength)

        model.setText("Fine.")
        #expect(model.canSave)
    }

    @Test("a failed save surfaces the server's message and returns nil")
    func failedSaveSurfaces() async throws {
        let api = FakeAPI()
        await api.setNextError(APIError(
            status: 400, code: "VALIDATION_ERROR", message: "That announcement is too long."
        ))
        let model = AnnouncementEditorViewModel(api: api, existing: nil)
        model.setText("Something")

        #expect(await model.save() == nil)
        #expect(model.errorMessage == "That announcement is too long.")
        #expect(model.isSaving == false, "the spinner stops even on failure")
    }

    /// Formatting moved out of the view body with the rest of the logic.
    @Test("the posted label is present only when editing")
    func postedLabelOnlyWhenEditing() {
        let api = FakeAPI()
        #expect(AnnouncementEditorViewModel(api: api, existing: nil).postedLabel == nil)
        #expect(
            AnnouncementEditorViewModel(api: api, existing: .fixture()).postedLabel != nil
        )
    }
}
