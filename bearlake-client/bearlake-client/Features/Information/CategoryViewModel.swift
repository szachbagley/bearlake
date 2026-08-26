//
//  CategoryViewModel.swift
//  bearlake-client
//

import Foundation
import Observation

@MainActor
@Observable
final class CategoryViewModel {
    let category: InfoCategory

    private(set) var articles: [ArticleSummary] = []
    private(set) var isLoading = false
    private(set) var isCreating = false
    private(set) var hasLoadedOnce = false
    var errorMessage: String?

    /// Set to the id of a just-created draft so the view can navigate
    /// straight into the editor.
    var newlyCreatedArticleID: String?

    /// C46. True when what is on screen came from the cache because the
    /// network failed — drives the banner and disables mutating controls.
    private(set) var isOffline = false

    private let api: BearLakeAPI
    private let cache: CacheStore?

    init(category: InfoCategory, api: BearLakeAPI, cache: CacheStore? = nil) {
        self.category = category
        self.api = api
        self.cache = cache
    }

    func load() async {
        guard isLoading == false else { return }
        isLoading = true
        defer { isLoading = false; hasLoadedOnce = true }
        do {
            // No client-side status filter (C38). Members are sent published
            // articles only; admins receive both. Filtering here would imply
            // drafts reach a member's device, which they do not.
            let fetched = try await api.listArticles(categoryID: category.id)
            articles = fetched
            errorMessage = nil
            isOffline = false
            cache?.save(articleSummaries: fetched, categoryID: category.id)
        } catch {
            switch CacheFallback.forList(
                error, cached: cache?.articleSummaries(categoryID: category.id) ?? [],
                fallback: "Couldn't load these articles."
            ) {
            case .cached(let items):
                articles = items
                isOffline = true
                errorMessage = nil
            case .failed(let message):
                isOffline = false
                errorMessage = message
            }
        }
    }

    /// `nonisolated` deliberately.
    ///
    /// The enclosing class is `@MainActor`, so without this the function
    /// inherits that isolation — and storing it in a plain
    /// `(String) -> String?` property erases the isolation rather than
    /// preserving it. Calling it from an async context then crashed with a
    /// bus error inside `trimmingCharacters`. A pure string check has no
    /// business being actor-isolated in the first place.
    nonisolated static func titleProblem(_ title: String) -> String? {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.count < Limits.articleTitleMin { return "An article needs a title." }
        if trimmed.count > Limits.articleTitleMax { return "That title is too long." }
        return nil
    }

    /// Creates an empty **draft** and returns its id.
    ///
    /// Draft-first is not a stylistic choice: `POST /uploads/presign` requires
    /// an existing `articleId`, so a photo block cannot be added to an article
    /// that has never been saved. Creating the row up front means block
    /// editing always happens against something persisted, and an admin who
    /// abandons the editor leaves a draft rather than losing their work —
    /// and a draft is invisible to the family (C38).
    func createDraft(title: String) async -> String? {
        guard Self.titleProblem(title) == nil, isCreating == false else { return nil }
        isCreating = true
        defer { isCreating = false }

        do {
            let created = try await api.createArticle(
                CreateArticleRequest(
                    categoryId: category.id,
                    title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                    blocks: [],
                    status: .draft
                )
            )
            articles.append(
                ArticleSummary(
                    id: created.id, categoryId: created.categoryId, title: created.title,
                    status: created.status, sortOrder: created.sortOrder,
                    updatedAt: created.updatedAt
                )
            )
            newlyCreatedArticleID = created.id
            return created.id
        } catch let error as APIError {
            errorMessage = error.message
            return nil
        } catch {
            errorMessage = "Couldn't create that article."
            return nil
        }
    }

    func deleteArticle(_ article: ArticleSummary) async {
        do {
            try await api.deleteArticle(id: article.id)
            articles.removeAll { $0.id == article.id }
        } catch let error as APIError {
            errorMessage = error.message
        } catch {
            errorMessage = "Couldn't delete that article."
        }
    }

    /// Whether to show a status badge beside a row.
    ///
    /// Only drafts are badged, and only admins ever receive one, so the badge
    /// doubles as a reminder that the family cannot see this article yet.
    func showsDraftBadge(for article: ArticleSummary) -> Bool {
        article.status == .draft
    }
}
