//
//  PreviewSupport.swift
//  bearlake-client
//
//  Doubles for SwiftUI previews. Wrapped in #if DEBUG so none of it reaches
//  a release build.
//
//  Separate from the test target's FakeAPI on purpose: previews live in the
//  app target and cannot see test code, and the two want different things —
//  a preview wants realistic content on screen, a test wants a controllable
//  double with call counts.
//

#if DEBUG
import Foundation

private let previewDate = Date(timeIntervalSince1970: 1_785_585_600)  // 2026-08-01

extension PublicUser {
    static let previewAdmin = PublicUser(
        id: "preview-admin", displayName: "Zach", email: "zach@example.com",
        role: .admin, mustChangePassword: false, isActive: true,
        lastLoginAt: previewDate, createdAt: previewDate, updatedAt: previewDate
    )
    static let previewMember = PublicUser(
        id: "preview-member", displayName: "Rachel", email: "rachel@example.com",
        role: .member, mustChangePassword: false, isActive: true,
        lastLoginAt: previewDate, createdAt: previewDate, updatedAt: previewDate
    )
}

/// An API that answers with plausible cabin content and never fails.
struct PreviewAPI: BearLakeAPI {
    var user: PublicUser = .previewAdmin

    func login(email: String, password: String) async throws -> SessionResult {
        SessionResult(accessToken: "preview", refreshToken: "preview", user: user)
    }
    func logout() async throws {}
    func changePassword(currentPassword: String, newPassword: String) async throws -> SessionResult {
        SessionResult(accessToken: "preview", refreshToken: "preview", user: user)
    }
    func me() async throws -> PublicUser { user }

    func listEvents(start: Date, end: Date) async throws -> [CalendarEvent] {
        [
            CalendarEvent(
                id: "1", title: "Zach and Rachel's friends stay at big cabin", notes: nil,
                startsAt: "2026-07-16", endsAt: "2026-07-20", isAllDay: true,
                createdBy: "preview-admin", creatorDisplayName: "Zach",
                createdAt: previewDate, updatedAt: previewDate
            ),
            CalendarEvent(
                id: "2", title: "Working on sauna construction", notes: "Materials arrive at 9:30.",
                startsAt: "2026-07-17T16:00:00.000Z", endsAt: "2026-07-17T17:00:00.000Z",
                isAllDay: false, createdBy: "preview-admin", creatorDisplayName: "Zach",
                createdAt: previewDate, updatedAt: previewDate
            ),
        ]
    }
    func createEvent(_ body: CreateEventRequest) async throws -> CalendarEvent {
        try await listEvents(start: previewDate, end: previewDate)[0]
    }
    func getEvent(id: String) async throws -> CalendarEvent {
        try await listEvents(start: previewDate, end: previewDate)[0]
    }
    func updateEvent(id: String, _ body: UpdateEventRequest) async throws -> CalendarEvent {
        try await listEvents(start: previewDate, end: previewDate)[0]
    }
    func deleteEvent(id: String) async throws {}

    func listAnnouncements(limit: Int?, cursor: String?) async throws -> AnnouncementPage {
        AnnouncementPage(
            items: [
                Announcement(
                    id: "1",
                    body: "New pool speakers! They are called \"Beosound Explore\".",
                    postedAt: previewDate, createdBy: "preview-admin",
                    createdAt: previewDate, updatedAt: previewDate
                ),
                Announcement(
                    id: "2",
                    body: "A family of foxes has been living at the bottom of the hill.",
                    postedAt: previewDate.addingTimeInterval(-86_400 * 30),
                    createdBy: "preview-admin",
                    createdAt: previewDate, updatedAt: previewDate
                ),
            ],
            nextCursor: nil
        )
    }
    func createAnnouncement(body: String) async throws -> Announcement {
        try await listAnnouncements(limit: nil, cursor: nil).items[0]
    }
    func updateAnnouncement(id: String, body: String) async throws -> Announcement {
        try await listAnnouncements(limit: nil, cursor: nil).items[0]
    }
    func deleteAnnouncement(id: String) async throws {}

    func listQuickTips() async throws -> [QuickTip] {
        [
            QuickTip(id: "1", body: "Pool house key is in the electrical box by the hot tub.",
                     sortOrder: 0, createdBy: "preview-admin",
                     createdAt: previewDate, updatedAt: previewDate),
        ]
    }
    func createQuickTip(_ body: CreateQuickTipRequest) async throws -> QuickTip {
        try await listQuickTips()[0]
    }
    func updateQuickTip(id: String, _ body: UpdateQuickTipRequest) async throws -> QuickTip {
        try await listQuickTips()[0]
    }
    func deleteQuickTip(id: String) async throws {}

    func listCategories() async throws -> [InfoCategory] {
        ["Pool & Hot Tub", "Main Cabin", "Boat, Lake, & Marina"].enumerated().map { index, title in
            InfoCategory(id: "cat\(index)", title: title, sortOrder: index,
                         createdAt: previewDate, updatedAt: previewDate)
        }
    }
    func createCategory(_ body: CreateCategoryRequest) async throws -> InfoCategory {
        try await listCategories()[0]
    }
    func updateCategory(id: String, _ body: UpdateCategoryRequest) async throws -> InfoCategory {
        try await listCategories()[0]
    }
    func deleteCategory(id: String) async throws {}

    func listArticles(categoryID: String) async throws -> [ArticleSummary] {
        [
            ArticleSummary(id: "a1", categoryId: categoryID, title: "Monitoring chemicals",
                           status: .published, sortOrder: 0, updatedAt: previewDate),
        ]
    }
    func getArticle(id: String) async throws -> InfoArticle {
        InfoArticle(
            id: id, categoryId: "cat0", title: "Monitoring chemicals",
            blocks: [.paragraph(id: "b1", text: "Check chlorine levels weekly.")],
            schemaVersion: 1, status: .published, sortOrder: 0,
            createdBy: "preview-admin", createdAt: previewDate, updatedAt: previewDate
        )
    }
    func createArticle(_ body: CreateArticleRequest) async throws -> InfoArticle {
        try await getArticle(id: "a1")
    }
    func updateArticle(id: String, _ body: UpdateArticleRequest) async throws -> InfoArticle {
        try await getArticle(id: id)
    }
    func deleteArticle(id: String) async throws {}

    func presignUpload(_ body: PresignUploadRequest) async throws -> PresignUploadResponse {
        PresignUploadResponse(key: "articles/x/y", uploadUrl: "https://example.invalid")
    }
}

/// A secure store that keeps nothing — previews must never touch the real
/// Keychain.
struct PreviewStore: SecureStore {
    func save(_ value: String, for key: String) throws {}
    func read(_ key: String) -> String? { nil }
    func delete(_ key: String) throws {}
}

extension AuthViewModel {
    /// A ViewModel wired to the preview doubles.
    @MainActor
    static func preview(user: PublicUser = .previewAdmin) -> AuthViewModel {
        AuthViewModel(
            api: PreviewAPI(user: user),
            tokens: TokenStore(secureStore: PreviewStore(), key: "preview")
        )
    }
}
#endif
