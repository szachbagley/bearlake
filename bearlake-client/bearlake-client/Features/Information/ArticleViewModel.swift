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

    /// C46. True when what is on screen came from the cache because the
    /// network failed — drives the banner and disables mutating controls.
    private(set) var isOffline = false

    private let api: BearLakeAPI
    private let cache: CacheStore?

    init(articleID: String, initialTitle: String, api: BearLakeAPI, cache: CacheStore? = nil) {
        self.articleID = articleID
        self.initialTitle = initialTitle
        self.api = api
        self.cache = cache
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

    /// Whether this article genuinely has no content.
    ///
    /// Requires an article: with none loaded — a failed fetch and nothing
    /// cached — the honest answer is "we don't know", and rendering "Nothing
    /// here yet. Add some content" underneath a connection error tells the
    /// user something false (C46).
    var isEmpty: Bool {
        guard let article else { return false }
        return hasLoadedOnce && article.blocks.isEmpty
    }

    func load() async {
        guard isLoading == false else { return }
        isLoading = true
        defer { isLoading = false; hasLoadedOnce = true }
        do {
            let fetched = try await api.getArticle(id: articleID)
            article = fetched
            errorMessage = nil
            isOffline = false
            cache?.save(article: fetched)
        } catch {
            switch CacheFallback.forItem(
                error, cached: cache?.article(id: articleID),
                fallback: "Couldn't load this article."
            ) {
            case .cached(let cached):
                article = cached
                isOffline = true
                errorMessage = nil
            case .failed(let message):
                isOffline = false
                errorMessage = message
            }
        }
    }
}
