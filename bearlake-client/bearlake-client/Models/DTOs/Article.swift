//
//  Article.swift
//  bearlake-client
//
//  The full article, blocks included. Deferred here from Phase 1 step 1
//  because it depends on Block.
//

import Foundation

struct InfoArticle: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let categoryId: String
    let title: String
    let blocks: [Block]
    let schemaVersion: Int
    let status: ArticleStatus
    let sortOrder: Int
    let createdBy: String
    let createdAt: Date
    let updatedAt: Date
}

/// `schemaVersion` is absent by design — the server stamps it, and a client
/// that sends it gets a 400 under the strict-body rule (C15).
struct CreateArticleRequest: Encodable, Sendable {
    let categoryId: String
    let title: String
    let blocks: [Block]
    let status: ArticleStatus
    let sortOrder: Int?

    init(
        categoryId: String,
        title: String,
        blocks: [Block],
        status: ArticleStatus,
        sortOrder: Int? = nil
    ) {
        self.categoryId = categoryId
        self.title = title
        self.blocks = blocks
        self.status = status
        self.sortOrder = sortOrder
    }
}

/// `updatedAt` is **required**, not optional — it is the optimistic-lock
/// token (C39). Omitting it is itself a validation error, and a stale value
/// is a 409 the editor surfaces as an offer to reload.
struct UpdateArticleRequest: Encodable, Sendable {
    var categoryId: String?
    var title: String?
    var blocks: [Block]?
    var status: ArticleStatus?
    var sortOrder: Int?
    let updatedAt: Date

    init(
        updatedAt: Date,
        categoryId: String? = nil,
        title: String? = nil,
        blocks: [Block]? = nil,
        status: ArticleStatus? = nil,
        sortOrder: Int? = nil
    ) {
        self.updatedAt = updatedAt
        self.categoryId = categoryId
        self.title = title
        self.blocks = blocks
        self.status = status
        self.sortOrder = sortOrder
    }
}
