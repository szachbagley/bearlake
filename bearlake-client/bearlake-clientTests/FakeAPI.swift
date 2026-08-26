//
//  FakeAPI.swift
//  bearlake-clientTests
//
//  An in-memory BearLakeAPI. Every later phase's ViewModel tests use this
//  rather than a stubbed URLSession — a ViewModel test should fail because
//  the ViewModel is wrong, not because a JSON fixture drifted.
//

import Foundation
@testable import bearlake_client

/// Configurable in-memory double.
///
/// An `actor` to match `APIClient`'s isolation, so ViewModels awaiting either
/// behave identically.
actor FakeAPI: BearLakeAPI {
    // Seedable state.
    var user = PublicUser.fixture()
    var events: [CalendarEvent] = []
    var announcements: [Announcement] = []
    var quickTips: [QuickTip] = []
    var categories: [InfoCategory] = []
    var articleSummaries: [String: [ArticleSummary]] = [:]
    var articles: [String: InfoArticle] = [:]

    /// When set, the next call to any method throws this instead.
    var nextError: APIError?
    /// Stays set, unlike `nextError`. A ViewModel that makes several calls
    /// per load needs every one of them to fail to simulate being offline.
    var alwaysFails: APIError?

    /// Call counts, for asserting a ViewModel did not fetch twice.
    private(set) var callCounts: [String: Int] = [:]

    func seed(
        user: PublicUser? = nil,
        events: [CalendarEvent]? = nil,
        announcements: [Announcement]? = nil,
        quickTips: [QuickTip]? = nil,
        categories: [InfoCategory]? = nil
    ) {
        if let user { self.user = user }
        if let events { self.events = events }
        if let announcements { self.announcements = announcements }
        if let quickTips { self.quickTips = quickTips }
        if let categories { self.categories = categories }
    }

    func setNextError(_ error: APIError?) { nextError = error }
    func setAlwaysFails(_ error: APIError?) { alwaysFails = error }
    func setArticle(_ article: InfoArticle) { articles[article.id] = article }
    func setArticleSummaries(_ categoryID: String, _ summaries: [ArticleSummary]) {
        articleSummaries[categoryID] = summaries
    }
    func callCount(_ name: String) -> Int { callCounts[name] ?? 0 }

    private func record(_ name: String) throws {
        callCounts[name, default: 0] += 1
        if let error = alwaysFails { throw error }
        if let error = nextError {
            nextError = nil
            throw error
        }
    }

    // MARK: - Auth

    func login(email: String, password: String) async throws -> SessionResult {
        try record("login")
        return SessionResult(accessToken: "access", refreshToken: "refresh", user: user)
    }

    func logout() async throws { try record("logout") }

    func changePassword(currentPassword: String, newPassword: String) async throws -> SessionResult {
        try record("changePassword")
        return SessionResult(accessToken: "access2", refreshToken: "refresh2", user: user)
    }

    func me() async throws -> PublicUser {
        try record("me")
        return user
    }

    // MARK: - Events

    func listEvents(start: Date, end: Date) async throws -> [CalendarEvent] {
        try record("listEvents")
        return events
    }

    func createEvent(_ body: CreateEventRequest) async throws -> CalendarEvent {
        try record("createEvent")
        let created = CalendarEvent.fixture(
            title: body.title, notes: body.notes,
            startsAt: body.startsAt, endsAt: body.endsAt, isAllDay: body.isAllDay
        )
        events.append(created)
        return created
    }

    func getEvent(id: String) async throws -> CalendarEvent {
        try record("getEvent")
        guard let found = events.first(where: { $0.id == id }) else { throw APIError.notFound }
        return found
    }

    func updateEvent(id: String, _ body: UpdateEventRequest) async throws -> CalendarEvent {
        try record("updateEvent")
        guard let index = events.firstIndex(where: { $0.id == id }) else { throw APIError.notFound }
        let existing = events[index]
        let updated = CalendarEvent.fixture(
            id: existing.id,
            title: body.title ?? existing.title,
            notes: existing.notes,
            startsAt: body.startsAt ?? existing.startsAt,
            endsAt: body.endsAt ?? existing.endsAt,
            isAllDay: body.isAllDay ?? existing.isAllDay
        )
        events[index] = updated
        return updated
    }

    func deleteEvent(id: String) async throws {
        try record("deleteEvent")
        events.removeAll { $0.id == id }
    }

    // MARK: - Announcements

    func listAnnouncements(limit: Int?, cursor: String?) async throws -> AnnouncementPage {
        try record("listAnnouncements")
        return AnnouncementPage(items: announcements, nextCursor: nil)
    }

    func createAnnouncement(body: String) async throws -> Announcement {
        try record("createAnnouncement")
        let created = Announcement.fixture(body: body)
        announcements.insert(created, at: 0)
        return created
    }

    func updateAnnouncement(id: String, body: String) async throws -> Announcement {
        try record("updateAnnouncement")
        guard let index = announcements.firstIndex(where: { $0.id == id }) else {
            throw APIError.notFound
        }
        let updated = Announcement.fixture(id: id, body: body)
        announcements[index] = updated
        return updated
    }

    func deleteAnnouncement(id: String) async throws {
        try record("deleteAnnouncement")
        announcements.removeAll { $0.id == id }
    }

    // MARK: - Quick tips

    func listQuickTips() async throws -> [QuickTip] {
        try record("listQuickTips")
        return quickTips
    }

    func createQuickTip(_ body: CreateQuickTipRequest) async throws -> QuickTip {
        try record("createQuickTip")
        let created = QuickTip.fixture(body: body.body)
        quickTips.append(created)
        return created
    }

    func updateQuickTip(id: String, _ body: UpdateQuickTipRequest) async throws -> QuickTip {
        try record("updateQuickTip")
        guard let index = quickTips.firstIndex(where: { $0.id == id }) else {
            throw APIError.notFound
        }
        let updated = QuickTip.fixture(id: id, body: body.body ?? quickTips[index].body)
        quickTips[index] = updated
        return updated
    }

    func deleteQuickTip(id: String) async throws {
        try record("deleteQuickTip")
        quickTips.removeAll { $0.id == id }
    }

    // MARK: - Knowledge base

    func listCategories() async throws -> [InfoCategory] {
        try record("listCategories")
        return categories
    }

    func createCategory(_ body: CreateCategoryRequest) async throws -> InfoCategory {
        try record("createCategory")
        let created = InfoCategory.fixture(title: body.title)
        categories.append(created)
        return created
    }

    func updateCategory(id: String, _ body: UpdateCategoryRequest) async throws -> InfoCategory {
        try record("updateCategory")
        guard let index = categories.firstIndex(where: { $0.id == id }) else {
            throw APIError.notFound
        }
        let updated = InfoCategory.fixture(id: id, title: body.title ?? categories[index].title)
        categories[index] = updated
        return updated
    }

    func deleteCategory(id: String) async throws {
        try record("deleteCategory")
        categories.removeAll { $0.id == id }
    }

    func listArticles(categoryID: String) async throws -> [ArticleSummary] {
        try record("listArticles")
        return articleSummaries[categoryID] ?? []
    }

    func getArticle(id: String) async throws -> InfoArticle {
        try record("getArticle")
        guard let found = articles[id] else { throw APIError.notFound }
        return found
    }

    func createArticle(_ body: CreateArticleRequest) async throws -> InfoArticle {
        try record("createArticle")
        let created = InfoArticle.fixture(
            categoryId: body.categoryId, title: body.title,
            blocks: body.blocks, status: body.status
        )
        articles[created.id] = created
        return created
    }

    func updateArticle(id: String, _ body: UpdateArticleRequest) async throws -> InfoArticle {
        try record("updateArticle")
        guard let existing = articles[id] else { throw APIError.notFound }
        // Optimistic locking, so ViewModel tests can exercise the 409 path.
        guard body.updatedAt == existing.updatedAt else { throw APIError.stale }
        let updated = InfoArticle.fixture(
            id: id, categoryId: existing.categoryId,
            title: body.title ?? existing.title,
            blocks: body.blocks ?? existing.blocks,
            status: body.status ?? existing.status,
            updatedAt: existing.updatedAt.addingTimeInterval(1)
        )
        articles[id] = updated
        return updated
    }

    func deleteArticle(id: String) async throws {
        try record("deleteArticle")
        articles[id] = nil
    }

    // MARK: - Uploads

    func presignUpload(_ body: PresignUploadRequest) async throws -> PresignUploadResponse {
        try record("presignUpload")
        return PresignUploadResponse(
            key: "articles/\(body.articleId)/00000000-0000-4000-8000-000000000001",
            uploadUrl: "https://example.invalid/upload"
        )
    }
}

// MARK: - Fixtures

extension APIError {
    static let notFound = APIError(status: 404, code: "NOT_FOUND", message: "Not found.")
    static let stale = APIError(
        status: 409, code: "STALE_ARTICLE",
        message: "This article changed since you opened it."
    )
}

private let fixedDate = Date(timeIntervalSince1970: 1_785_585_600)  // 2026-08-01T12:00:00Z

extension PublicUser {
    static func fixture(
        id: String = "00000000-0000-4000-8000-0000000000u1",
        displayName: String = "Zach",
        role: UserRole = .admin,
        mustChangePassword: Bool = false,
        isActive: Bool = true
    ) -> PublicUser {
        PublicUser(
            id: id, displayName: displayName, email: "zach@example.com", role: role,
            mustChangePassword: mustChangePassword, isActive: isActive,
            lastLoginAt: nil, createdAt: fixedDate, updatedAt: fixedDate
        )
    }
}

extension CalendarEvent {
    static func fixture(
        id: String = UUID().uuidString.lowercased(),
        title: String = "Family stay",
        notes: String? = nil,
        startsAt: String = "2026-07-16",
        endsAt: String = "2026-07-20",
        isAllDay: Bool = true,
        creatorDisplayName: String = "Zach"
    ) -> CalendarEvent {
        CalendarEvent(
            id: id, title: title, notes: notes,
            startsAt: startsAt, endsAt: endsAt, isAllDay: isAllDay,
            createdBy: "00000000-0000-4000-8000-0000000000u1",
            creatorDisplayName: creatorDisplayName,
            createdAt: fixedDate, updatedAt: fixedDate
        )
    }
}

extension Announcement {
    static func fixture(
        id: String = UUID().uuidString.lowercased(),
        body: String = "The marina code changed."
    ) -> Announcement {
        Announcement(
            id: id, body: body, postedAt: fixedDate,
            createdBy: "00000000-0000-4000-8000-0000000000u1",
            createdAt: fixedDate, updatedAt: fixedDate
        )
    }
}

extension QuickTip {
    static func fixture(
        id: String = UUID().uuidString.lowercased(),
        body: String = "Keys are in the lockbox.",
        sortOrder: Int = 0
    ) -> QuickTip {
        QuickTip(
            id: id, body: body, sortOrder: sortOrder,
            createdBy: "00000000-0000-4000-8000-0000000000u1",
            createdAt: fixedDate, updatedAt: fixedDate
        )
    }
}

extension InfoCategory {
    static func fixture(
        id: String = UUID().uuidString.lowercased(),
        title: String = "Boat",
        sortOrder: Int = 0
    ) -> InfoCategory {
        InfoCategory(
            id: id, title: title, sortOrder: sortOrder,
            createdAt: fixedDate, updatedAt: fixedDate
        )
    }
}

extension ArticleSummary {
    static func fixture(
        id: String = UUID().uuidString.lowercased(),
        categoryId: String = "cat1",
        title: String = "Starting the boat",
        status: ArticleStatus = .published
    ) -> ArticleSummary {
        ArticleSummary(
            id: id, categoryId: categoryId, title: title,
            status: status, sortOrder: 0, updatedAt: fixedDate
        )
    }
}

extension InfoArticle {
    static func fixture(
        id: String = UUID().uuidString.lowercased(),
        categoryId: String = "cat1",
        title: String = "Starting the boat",
        blocks: [Block] = [.paragraph(id: "b1", text: "Turn the key.")],
        status: ArticleStatus = .published,
        updatedAt: Date = fixedDate
    ) -> InfoArticle {
        InfoArticle(
            id: id, categoryId: categoryId, title: title, blocks: blocks,
            schemaVersion: 1, status: status, sortOrder: 0,
            createdBy: "00000000-0000-4000-8000-0000000000u1",
            createdAt: fixedDate, updatedAt: updatedAt
        )
    }
}
