//
//  BearLakeAPI.swift
//  bearlake-client
//
//  Every call the app can make. ViewModels depend on this protocol, never on
//  APIClient, so they are testable without a server (C14).
//
//  Endpoints and envelope shapes are transcribed from
//  bearlake-web/src/api/endpoints.ts, which is verified against the running
//  server (C16). User-management endpoints are deliberately absent: iOS never
//  creates, edits, lists, or resets users (C49).
//

import Foundation

protocol BearLakeAPI: Sendable {
    // MARK: - Auth

    /// No token exists yet, so this never goes through the 401 refresh cycle.
    func login(email: String, password: String) async throws -> SessionResult
    /// Best-effort: revokes the token server-side. The caller clears local
    /// state regardless of whether this succeeds (C21).
    func logout() async throws
    /// Allowed while `mustChangePassword` is set, when nothing else is.
    func changePassword(currentPassword: String, newPassword: String) async throws -> SessionResult
    func me() async throws -> PublicUser

    // MARK: - Events

    /// `start` and `end` are required — there is no unbounded events query.
    /// The window is capped server-side at `Limits.eventRangeMaxWindowDays`.
    func listEvents(start: Date, end: Date) async throws -> [CalendarEvent]
    func createEvent(_ body: CreateEventRequest) async throws -> CalendarEvent
    func getEvent(id: String) async throws -> CalendarEvent
    func updateEvent(id: String, _ body: UpdateEventRequest) async throws -> CalendarEvent
    func deleteEvent(id: String) async throws

    // MARK: - Announcements

    func listAnnouncements(limit: Int?, cursor: String?) async throws -> AnnouncementPage
    func createAnnouncement(body: String) async throws -> Announcement
    func updateAnnouncement(id: String, body: String) async throws -> Announcement
    func deleteAnnouncement(id: String) async throws

    // MARK: - Quick tips

    func listQuickTips() async throws -> [QuickTip]
    func createQuickTip(_ body: CreateQuickTipRequest) async throws -> QuickTip
    func updateQuickTip(id: String, _ body: UpdateQuickTipRequest) async throws -> QuickTip
    func deleteQuickTip(id: String) async throws

    // MARK: - Knowledge base

    func listCategories() async throws -> [InfoCategory]
    func createCategory(_ body: CreateCategoryRequest) async throws -> InfoCategory
    func updateCategory(id: String, _ body: UpdateCategoryRequest) async throws -> InfoCategory
    func deleteCategory(id: String) async throws

    /// Members receive published articles only; admins receive drafts too.
    /// The filtering is the server's, keyed off the caller's role — never a
    /// client-side filter.
    func listArticles(categoryID: String) async throws -> [ArticleSummary]
    func getArticle(id: String) async throws -> InfoArticle
    func createArticle(_ body: CreateArticleRequest) async throws -> InfoArticle
    /// Carries the `updatedAt` the client loaded; a stale value is a 409
    /// with code `STALE_ARTICLE` (C39).
    func updateArticle(id: String, _ body: UpdateArticleRequest) async throws -> InfoArticle
    func deleteArticle(id: String) async throws

    // MARK: - Uploads

    func presignUpload(_ body: PresignUploadRequest) async throws -> PresignUploadResponse
}
