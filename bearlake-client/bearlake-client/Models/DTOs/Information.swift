//
//  Information.swift
//  bearlake-client
//
//  Categories and article summaries. The full `InfoArticle` lives in
//  Models/Block.swift's orbit — see Models/DTOs/Article.swift — because it
//  carries decoded blocks.
//

import Foundation

struct InfoCategory: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let title: String
    let sortOrder: Int
    let createdAt: Date
    let updatedAt: Date
}

struct CreateCategoryRequest: Encodable, Sendable {
    let title: String
    let sortOrder: Int?

    init(title: String, sortOrder: Int? = nil) {
        self.title = title
        self.sortOrder = sortOrder
    }
}

struct UpdateCategoryRequest: Encodable, Sendable {
    let title: String?
    let sortOrder: Int?

    init(title: String? = nil, sortOrder: Int? = nil) {
        self.title = title
        self.sortOrder = sortOrder
    }
}

struct ListCategoriesResponse: Decodable, Sendable {
    let categories: [InfoCategory]
}

enum ArticleStatus: String, Codable, Sendable, CaseIterable {
    case draft
    case published
}

/// The lightweight shape returned by the category article list — no blocks,
/// so a list stays cheap even for a long article.
struct ArticleSummary: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let categoryId: String
    let title: String
    let status: ArticleStatus
    let sortOrder: Int
    let updatedAt: Date
}

struct ListArticleSummariesResponse: Decodable, Sendable {
    let articles: [ArticleSummary]
}
