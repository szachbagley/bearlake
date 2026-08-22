//
//  Announcement.swift
//  bearlake-client
//

import Foundation

struct Announcement: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let body: String
    let postedAt: Date
    let createdBy: String
    let createdAt: Date
    let updatedAt: Date
}

struct CreateAnnouncementRequest: Encodable, Sendable {
    let body: String
}

/// `body` is required on update too — `postedAt` is the only fixed field.
struct UpdateAnnouncementRequest: Encodable, Sendable {
    let body: String
}

/// Cursor-paginated. `nextCursor` is nil on the last page.
struct AnnouncementPage: Decodable, Sendable, Equatable {
    let items: [Announcement]
    let nextCursor: String?
}
