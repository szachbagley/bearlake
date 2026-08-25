//
//  ArticleViewModel.swift
//  bearlake-client
//

import Foundation
import Observation

@MainActor
@Observable
final class ArticleViewModel {
    let articleID: String
    /// Known before the fetch, so the navigation title is right immediately
    /// rather than appearing after a round trip.
    let initialTitle: String

    private(set) var article: InfoArticle?
    private(set) var isLoading = false
    private(set) var hasLoadedOnce = false
    var errorMessage: String?

    private let api: BearLakeAPI

    init(articleID: String, initialTitle: String, api: BearLakeAPI) {
        self.articleID = articleID
        self.initialTitle = initialTitle
        self.api = api
    }

    var title: String { article?.title ?? initialTitle }

    /// Blocks in array order — the order is the document (spec §4.2), so it
    /// is never re-sorted or grouped by type.
    var blocks: [Block] { article?.blocks ?? [] }

    /// True when the article has loaded and every block it contains is one
    /// this build cannot render. Without this the reader would see a title
    /// and then nothing at all, with no explanation.
    var isEntirelyUnrenderable: Bool {
        guard let article, article.blocks.isEmpty == false else { return false }
        return article.blocks.allSatisfy(\.isUnknown)
    }

    var isEmpty: Bool {
        hasLoadedOnce && (article?.blocks.isEmpty ?? true)
    }

    func load() async {
        guard isLoading == false else { return }
        isLoading = true
        defer { isLoading = false; hasLoadedOnce = true }
        do {
            article = try await api.getArticle(id: articleID)
            errorMessage = nil
        } catch let error as APIError {
            errorMessage = error.message
        } catch {
            errorMessage = "Couldn't load this article."
        }
    }
}
