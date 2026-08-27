//
//  CachedModels.swift
//  bearlake-client
//
//  SwiftData mirrors of the read DTOs (C45). Cache only — the API is the
//  source of truth, and nothing here is ever written back to the server.
//
//  Each type carries the server `id` as its unique attribute so a repeated
//  fetch upserts rather than duplicating, and each converts to and from the
//  DTO the rest of the app already speaks. Views and ViewModels keep working
//  in DTOs; the `@Model` classes never leave this layer.
//

import Foundation
import SwiftData

// MARK: - Announcements

@Model
final class CachedAnnouncement {
    @Attribute(.unique) var id: String
    var text: String
    var postedAt: Date
    var createdBy: String
    var createdAt: Date
    var updatedAt: Date

    init(_ dto: Announcement) {
        id = dto.id
        text = dto.body
        postedAt = dto.postedAt
        createdBy = dto.createdBy
        createdAt = dto.createdAt
        updatedAt = dto.updatedAt
    }

    /// Overwrites in place. SwiftData tracks the change; replacing the object
    /// would break the unique constraint on `id`.
    func update(from dto: Announcement) {
        text = dto.body
        postedAt = dto.postedAt
        createdBy = dto.createdBy
        createdAt = dto.createdAt
        updatedAt = dto.updatedAt
    }

    var dto: Announcement {
        Announcement(
            id: id, body: text, postedAt: postedAt,
            createdBy: createdBy, createdAt: createdAt, updatedAt: updatedAt
        )
    }
}

// MARK: - Events

@Model
final class CachedEvent {
    @Attribute(.unique) var id: String
    var title: String
    var notes: String?
    /// C22: all-day dates stay `String` end to end — including through the
    /// cache. Storing these as `Date` would reintroduce the exact
    /// UTC-midnight bug the rule exists to prevent, one layer lower.
    var startsAt: String
    var endsAt: String
    var isAllDay: Bool
    var createdBy: String
    var creatorDisplayName: String
    var createdAt: Date
    var updatedAt: Date

    init(_ dto: CalendarEvent) {
        id = dto.id
        title = dto.title
        notes = dto.notes
        startsAt = dto.startsAt
        endsAt = dto.endsAt
        isAllDay = dto.isAllDay
        createdBy = dto.createdBy
        creatorDisplayName = dto.creatorDisplayName
        createdAt = dto.createdAt
        updatedAt = dto.updatedAt
    }

    func update(from dto: CalendarEvent) {
        title = dto.title
        notes = dto.notes
        startsAt = dto.startsAt
        endsAt = dto.endsAt
        isAllDay = dto.isAllDay
        createdBy = dto.createdBy
        creatorDisplayName = dto.creatorDisplayName
        createdAt = dto.createdAt
        updatedAt = dto.updatedAt
    }

    var dto: CalendarEvent {
        CalendarEvent(
            id: id, title: title, notes: notes,
            startsAt: startsAt, endsAt: endsAt, isAllDay: isAllDay,
            createdBy: createdBy, creatorDisplayName: creatorDisplayName,
            createdAt: createdAt, updatedAt: updatedAt
        )
    }
}

// MARK: - Quick tips

@Model
final class CachedQuickTip {
    @Attribute(.unique) var id: String
    var text: String
    var sortOrder: Int
    var createdBy: String
    var createdAt: Date
    var updatedAt: Date

    init(_ dto: QuickTip) {
        id = dto.id
        text = dto.body
        sortOrder = dto.sortOrder
        createdBy = dto.createdBy
        createdAt = dto.createdAt
        updatedAt = dto.updatedAt
    }

    func update(from dto: QuickTip) {
        text = dto.body
        sortOrder = dto.sortOrder
        createdBy = dto.createdBy
        createdAt = dto.createdAt
        updatedAt = dto.updatedAt
    }

    var dto: QuickTip {
        QuickTip(
            id: id, body: text, sortOrder: sortOrder,
            createdBy: createdBy, createdAt: createdAt, updatedAt: updatedAt
        )
    }
}

// MARK: - Knowledge base

@Model
final class CachedCategory {
    @Attribute(.unique) var id: String
    var title: String
    var sortOrder: Int
    var createdAt: Date
    var updatedAt: Date

    init(_ dto: InfoCategory) {
        id = dto.id
        title = dto.title
        sortOrder = dto.sortOrder
        createdAt = dto.createdAt
        updatedAt = dto.updatedAt
    }

    func update(from dto: InfoCategory) {
        title = dto.title
        sortOrder = dto.sortOrder
        createdAt = dto.createdAt
        updatedAt = dto.updatedAt
    }

    var dto: InfoCategory {
        InfoCategory(
            id: id, title: title, sortOrder: sortOrder,
            createdAt: createdAt, updatedAt: updatedAt
        )
    }
}

@Model
final class CachedArticleSummary {
    @Attribute(.unique) var id: String
    var categoryId: String
    var title: String
    /// Stored as the raw value: `@Model` handles `RawRepresentable` enums, but
    /// a String keeps the store readable and survives a case being added.
    var statusRaw: String
    var sortOrder: Int
    var updatedAt: Date

    init(_ dto: ArticleSummary) {
        id = dto.id
        categoryId = dto.categoryId
        title = dto.title
        statusRaw = dto.status.rawValue
        sortOrder = dto.sortOrder
        updatedAt = dto.updatedAt
    }

    func update(from dto: ArticleSummary) {
        categoryId = dto.categoryId
        title = dto.title
        statusRaw = dto.status.rawValue
        sortOrder = dto.sortOrder
        updatedAt = dto.updatedAt
    }

    var dto: ArticleSummary {
        ArticleSummary(
            id: id, categoryId: categoryId, title: title,
            status: ArticleStatus(rawValue: statusRaw) ?? .published,
            sortOrder: sortOrder, updatedAt: updatedAt
        )
    }
}

@Model
final class CachedArticle {
    @Attribute(.unique) var id: String
    var categoryId: String
    var title: String
    /// C45: blocks as a JSON blob, decoded on read.
    ///
    /// The alternative — a `@Model` per block type — would have to model the
    /// `unknown` case, and an unknown block is by definition a shape this
    /// build cannot describe. A blob round-trips it byte-for-byte, which is
    /// exactly the §11.5 requirement.
    var blocksData: Data
    var schemaVersion: Int
    var statusRaw: String
    var sortOrder: Int
    var createdBy: String
    var createdAt: Date
    var updatedAt: Date

    init(_ dto: InfoArticle) throws {
        id = dto.id
        categoryId = dto.categoryId
        title = dto.title
        blocksData = try APICoding.makeEncoder().encode(dto.blocks)
        schemaVersion = dto.schemaVersion
        statusRaw = dto.status.rawValue
        sortOrder = dto.sortOrder
        createdBy = dto.createdBy
        createdAt = dto.createdAt
        updatedAt = dto.updatedAt
    }

    func update(from dto: InfoArticle) throws {
        categoryId = dto.categoryId
        title = dto.title
        blocksData = try APICoding.makeEncoder().encode(dto.blocks)
        schemaVersion = dto.schemaVersion
        statusRaw = dto.status.rawValue
        sortOrder = dto.sortOrder
        createdBy = dto.createdBy
        createdAt = dto.createdAt
        updatedAt = dto.updatedAt
    }

    /// - Note: image blocks come back with `url == nil`, because a presigned
    ///   URL expires in fifteen minutes and persisting one would bake in an
    ///   expiry (C34). Offline, an article's text renders and its photos show
    ///   the unavailable placeholder. That is the honest outcome, not a bug.
    var dto: InfoArticle {
        get throws {
            InfoArticle(
                id: id, categoryId: categoryId, title: title,
                blocks: try APICoding.makeDecoder().decode([Block].self, from: blocksData),
                schemaVersion: schemaVersion,
                status: ArticleStatus(rawValue: statusRaw) ?? .published,
                sortOrder: sortOrder, createdBy: createdBy,
                createdAt: createdAt, updatedAt: updatedAt
            )
        }
    }
}

// MARK: - Schema

enum CacheSchema {
    /// Tripwire for `CacheStore.clear()`, which must list these concretely
    /// rather than looping this array — see the comment there. A test asserts
    /// this count, so adding a `@Model` without updating `clear()` fails
    /// rather than silently leaving one table full after sign-out.
    static let modelCount = 6

    /// Every `@Model` type in the store. `ModelContainer` needs the full list;
    /// omitting one makes its inserts fail at runtime rather than at build.
    static let models: [any PersistentModel.Type] = [
        CachedAnnouncement.self,
        CachedEvent.self,
        CachedQuickTip.self,
        CachedCategory.self,
        CachedArticleSummary.self,
        CachedArticle.self,
    ]
}
