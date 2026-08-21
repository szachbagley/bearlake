//
//  QuickTip.swift
//  bearlake-client
//

import Foundation

struct QuickTip: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let body: String
    let sortOrder: Int
    let createdBy: String
    let createdAt: Date
    let updatedAt: Date
}

struct CreateQuickTipRequest: Encodable, Sendable {
    let body: String
    /// Optional on the wire: the server appends when it is absent.
    let sortOrder: Int?

    init(body: String, sortOrder: Int? = nil) {
        self.body = body
        self.sortOrder = sortOrder
    }
}

struct UpdateQuickTipRequest: Encodable, Sendable {
    let body: String?
    let sortOrder: Int?

    init(body: String? = nil, sortOrder: Int? = nil) {
        self.body = body
        self.sortOrder = sortOrder
    }
}

struct ListQuickTipsResponse: Decodable, Sendable {
    let quickTips: [QuickTip]
}
