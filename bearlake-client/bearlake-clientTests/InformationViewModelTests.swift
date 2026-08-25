//
//  InformationViewModelTests.swift
//  bearlake-clientTests
//

import Foundation
import Testing
@testable import bearlake_client

@MainActor
private func makeInfo(api: FakeAPI = FakeAPI()) -> (InformationViewModel, FakeAPI) {
    (InformationViewModel(api: api), api)
}

// MARK: - Loading

@MainActor
struct InformationLoadTests {
    @Test("both sections load")
    func loadsBoth() async throws {
        let (model, api) = makeInfo()
        await api.seed(
            quickTips: [.fixture(body: "Marina code is 0000")],
            categories: [.fixture(title: "Pool & Hot Tub")]
        )
        await model.load()
        #expect(model.quickTips.count == 1)
        #expect(model.categories.count == 1)
        #expect(model.errorMessage == nil)
    }

    /// Quick tips arrive in the server's sortOrder and are not re-sorted, so
    /// an admin's ordering is the single source of truth.
    @Test("quick tips keep the order the server sent")
    func keepsServerOrder() async throws {
        let (model, api) = makeInfo()
        await api.seed(quickTips: [
            .fixture(id: "c", body: "Third", sortOrder: 2),
            .fixture(id: "a", body: "First", sortOrder: 0),
            .fixture(id: "b", body: "Second", sortOrder: 1),
        ])
        await model.load()
        #expect(model.quickTips.map(\.id) == ["c", "a", "b"], "no client-side re-sort")
    }

    @Test("one section failing does not blank the other")
    func partialFailure() async throws {
        let (model, api) = makeInfo()
        await api.seed(categories: [.fixture(title: "Boat")])
        // Quick tips are requested first, so this error hits that call.
        await api.setNextError(APIError(status: 500, code: "INTERNAL", message: "Server error."))

        await model.load()
        #expect(model.quickTips.isEmpty)
        #expect(model.categories.count == 1, "the knowledge base still loaded")
        #expect(model.errorMessage == "Server error.")
    }
}

// MARK: - Quick tips

@MainActor
struct QuickTipTests {
    @Test("creating appends and hits the endpoint once")
    func createsTip() async throws {
        let (model, api) = makeInfo()
        await model.load()
        #expect(await model.saveQuickTip("Pool house key is by the hot tub", existing: nil))
        #expect(model.quickTips.count == 1)
        #expect(await api.callCount("createQuickTip") == 1)
    }

    @Test("editing replaces in place")
    func editsTip() async throws {
        let (model, api) = makeInfo()
        await api.seed(quickTips: [.fixture(id: "t1", body: "Old")])
        await model.load()

        #expect(await model.saveQuickTip("New", existing: model.quickTips[0]))
        #expect(model.quickTips.count == 1)
        #expect(model.quickTips[0].body == "New")
        #expect(await api.callCount("updateQuickTip") == 1)
    }

    @Test("deleting removes the row")
    func deletesTip() async throws {
        let (model, api) = makeInfo()
        await api.seed(quickTips: [.fixture(id: "t1"), .fixture(id: "t2")])
        await model.load()

        await model.deleteQuickTip(model.quickTips[0])
        #expect(model.quickTips.map(\.id) == ["t2"])
        #expect(await api.callCount("deleteQuickTip") == 1)
    }

    @Test("an over-length or empty body never reaches the network")
    func validationBlocksRequest() async throws {
        let (model, api) = makeInfo()
        #expect(await model.saveQuickTip("", existing: nil) == false)
        #expect(await model.saveQuickTip("   ", existing: nil) == false)
        #expect(await model.saveQuickTip(
            String(repeating: "a", count: Limits.quickTipBodyMax + 1), existing: nil
        ) == false)
        #expect(await api.callCount("createQuickTip") == 0)

        #expect(await model.saveQuickTip(
            String(repeating: "a", count: Limits.quickTipBodyMax), existing: nil
        ), "exactly at the cap is allowed")
    }

    @Test("the validation rule the editor uses is the one under test")
    func validationRule() {
        #expect(InformationViewModel.quickTipProblem(body: "Gate code 1234") == nil)
        #expect(InformationViewModel.quickTipProblem(body: "") != nil)
        #expect(InformationViewModel.quickTipProblem(
            body: String(repeating: "x", count: Limits.quickTipBodyMax + 1)
        ) != nil)
    }

    /// A member reaching this path gets the server's explanation. Hiding the
    /// control is an affordance, not the boundary (C48).
    @Test("a FORBIDDEN delete keeps the row and shows the server's message")
    func forbiddenDelete() async throws {
        let (model, api) = makeInfo()
        await api.seed(quickTips: [.fixture(id: "t1")])
        await model.load()

        await api.setNextError(APIError(
            status: 403, code: "FORBIDDEN", message: "Only an admin can delete quick tips."
        ))
        await model.deleteQuickTip(model.quickTips[0])

        #expect(model.quickTips.count == 1, "the row stays")
        #expect(model.errorMessage == "Only an admin can delete quick tips.")
    }
}

// MARK: - Categories

@MainActor
struct CategoryCRUDTests {
    @Test("creating appends and renaming replaces in place")
    func createAndRename() async throws {
        let (model, api) = makeInfo()
        await model.load()

        #expect(await model.saveCategory("Boat, Lake, & Marina", existing: nil))
        #expect(model.categories.count == 1)
        #expect(await api.callCount("createCategory") == 1)

        #expect(await model.saveCategory("Boat & Marina", existing: model.categories[0]))
        #expect(model.categories[0].title == "Boat & Marina")
        #expect(await api.callCount("updateCategory") == 1)
    }

    @Test("an empty or over-length name never reaches the network")
    func categoryValidation() async throws {
        let (model, api) = makeInfo()
        #expect(await model.saveCategory("", existing: nil) == false)
        #expect(await model.saveCategory(
            String(repeating: "a", count: Limits.categoryTitleMax + 1), existing: nil
        ) == false)
        #expect(await api.callCount("createCategory") == 0)
    }

    @Test("deleting an empty category removes it")
    func deleteEmptyCategory() async throws {
        let (model, api) = makeInfo()
        await api.seed(categories: [.fixture(id: "c1"), .fixture(id: "c2")])
        await model.load()

        await model.deleteCategory(model.categories[0])
        #expect(model.categories.map(\.id) == ["c2"])
    }

    /// The specific case step 4 calls out. The server's message tells the
    /// admin the articles have to go first; a generic "couldn't delete"
    /// leaves them with no idea what to do next.
    @Test("CATEGORY_NOT_EMPTY surfaces the server's specific guidance")
    func categoryNotEmptySurfaces() async throws {
        let (model, api) = makeInfo()
        await api.seed(categories: [.fixture(id: "c1", title: "Pool")])
        await model.load()

        await api.setNextError(APIError(
            status: 409, code: "CATEGORY_NOT_EMPTY",
            message: "Move or delete this category's articles before deleting it."
        ))
        await model.deleteCategory(model.categories[0])

        #expect(model.categories.count == 1, "the category stays")
        #expect(
            model.errorMessage == "Move or delete this category's articles before deleting it.",
            "the server's guidance must survive verbatim"
        )
        #expect(model.errorMessage?.contains("Couldn't") == false, "not the generic fallback")
    }
}

// MARK: - Category articles

@MainActor
private func makeCategory(
    api: FakeAPI = FakeAPI(),
    category: InfoCategory = .fixture(id: "cat1", title: "Pool & Hot Tub")
) -> (CategoryViewModel, FakeAPI) {
    (CategoryViewModel(category: category, api: api), api)
}

@MainActor
struct CategoryArticleTests {
    @Test("the list is shown exactly as the server sent it")
    func noClientSideFilter() async throws {
        let (model, api) = makeCategory()
        // An admin receives both statuses; a member would receive only the
        // published one. The client filters neither (C38).
        await api.seed()
        await api.setArticleSummaries("cat1", [
            .fixture(id: "a1", categoryId: "cat1", title: "Published", status: .published),
            .fixture(id: "a2", categoryId: "cat1", title: "Draft", status: .draft),
        ])

        await model.load()
        #expect(model.articles.map(\.title) == ["Published", "Draft"])
        #expect(model.articles.count == 2, "no client-side status filter")
    }

    @Test("only drafts get a badge")
    func draftBadge() async throws {
        let (model, _) = makeCategory()
        #expect(model.showsDraftBadge(for: .fixture(status: .draft)))
        #expect(model.showsDraftBadge(for: .fixture(status: .published)) == false)
    }

    /// Draft-first exists because POST /uploads/presign needs an existing
    /// articleId — a photo block cannot be added to something never saved.
    @Test("new article creates a draft and returns its id")
    func createsDraft() async throws {
        let (model, api) = makeCategory()
        await model.load()

        let id = await model.createDraft(title: "Monitoring chemicals")
        #expect(id != nil)
        #expect(model.newlyCreatedArticleID == id, "the view navigates to this")
        #expect(await api.callCount("createArticle") == 1)
        #expect(model.articles.count == 1)
        #expect(model.articles[0].status == .draft, "never published on creation")
    }

    @Test("the create request carries status draft and no blocks")
    func createRequestShape() throws {
        let request = CreateArticleRequest(
            categoryId: "cat1", title: "New", blocks: [], status: .draft
        )
        let data = try APICoding.makeEncoder().encode(request)
        let body = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(body["status"] as? String == "draft")
        #expect((body["blocks"] as? [Any])?.isEmpty == true)
        // schemaVersion is the server's to stamp; sending it is a 400.
        #expect(body["schemaVersion"] == nil)
        #expect(Set(body.keys) == ["categoryId", "title", "blocks", "status"])
    }

    @Test("an empty title never reaches the network")
    func titleValidation() async throws {
        let (model, api) = makeCategory()
        #expect(await model.createDraft(title: "") == nil)
        #expect(await model.createDraft(title: "   ") == nil)
        #expect(await api.callCount("createArticle") == 0)
    }

    @Test("deleting removes the row")
    func deletesArticle() async throws {
        let (model, api) = makeCategory()
        await api.setArticleSummaries("cat1", [
            .fixture(id: "a1", categoryId: "cat1"), .fixture(id: "a2", categoryId: "cat1"),
        ])
        await model.load()

        await model.deleteArticle(model.articles[0])
        #expect(model.articles.map(\.id) == ["a2"])
    }

    @Test("a failed create surfaces the server's message")
    func failedCreateSurfaces() async throws {
        let (model, api) = makeCategory()
        await api.setNextError(APIError(
            status: 403, code: "FORBIDDEN", message: "Only an admin can add articles."
        ))
        #expect(await model.createDraft(title: "New") == nil)
        #expect(model.errorMessage == "Only an admin can add articles.")
    }
}
