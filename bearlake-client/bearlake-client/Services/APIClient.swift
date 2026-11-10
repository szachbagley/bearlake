//
//  APIClient.swift
//  bearlake-client
//

import Foundation

/// The `URLSession` implementation of `BearLakeAPI`.
///
/// An `actor` because the 401 refresh must be single-flight (C18) and that
/// requires serialised access to the in-flight refresh task.
actor APIClient: BearLakeAPI {
    private let baseURL: URL
    private let session: URLSession
    private let tokens: TokenStore
    private let decoder = APICoding.makeDecoder()
    private let encoder = APICoding.makeEncoder()

    /// Called when the session cannot be recovered — a failed refresh, or a
    /// 401 with no refresh token at all. The app routes to login.
    private var sessionGeneration = UUID()
    private let onSessionUpdated: @Sendable (PublicUser) async -> Void
    private let onSessionExpired: @Sendable () async -> Void

    /// Called when any route answers `PASSWORD_CHANGE_REQUIRED`.
    ///
    /// The gate is not only a login-time condition: an admin can reset a
    /// user's password while that user has the app open, and every
    /// subsequent request then 403s with this code. Intercepting centrally
    /// means the app flips into the forced-change state from wherever it
    /// fires, rather than each call site having to recognise it (step 4).
    private let onPasswordChangeRequired: @Sendable () async -> Void

    /// The refresh currently in progress, if any. Concurrent 401s await this
    /// same task rather than each starting their own.
    private var refreshTask: Task<Bool, Error>?
    private var refreshTaskID: UUID?
    // Requests already underway share an outcome even if their 401 arrives
    // just after that flight completes. A new request snapshots the new ID.
    private var completedRefresh: (id: UUID, result: Result<Bool, Error>)?

    init(
        baseURL: URL,
        session: URLSession = .shared,
        tokens: TokenStore,
        onSessionExpired: @escaping @Sendable () async -> Void = {},
        onPasswordChangeRequired: @escaping @Sendable () async -> Void = {},
        onSessionUpdated: @escaping @Sendable (PublicUser) async -> Void = { _ in }
    ) {
        self.baseURL = baseURL
        self.session = session
        self.tokens = tokens
        self.onSessionUpdated = onSessionUpdated
        self.onSessionExpired = onSessionExpired
        self.onPasswordChangeRequired = onPasswordChangeRequired
    }

    // MARK: - Request plumbing

    private enum Method: String {
        case get = "GET", post = "POST", patch = "PATCH", delete = "DELETE"
    }

    private func makeRequest(
        path: String,
        method: Method,
        query: [URLQueryItem] = [],
        body: Data? = nil,
        accessToken: String?
    ) throws -> URLRequest {
        guard var components = URLComponents(
            url: baseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        ) else {
            throw APIError.unparsable(status: 0)
        }
        if query.isEmpty == false { components.queryItems = query }
        guard let url = components.url else { throw APIError.unparsable(status: 0) }

        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        request.httpBody = body
        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    /// Performs a request, refreshing once on a 401 and retrying.
    ///
    /// - Parameter allowRefresh: false for `/auth/refresh` itself, which is
    ///   the recovery mechanism and must never try to recover from its own
    ///   401, and for `/auth/login`, where no session exists yet.
    private func perform(
        path: String,
        method: Method,
        query: [URLQueryItem] = [],
        body: Data? = nil,
        authenticated: Bool = true,
        allowRefresh: Bool = true
    ) async throws -> Data {
        let generation = sessionGeneration
        let previousRefreshID = completedRefresh?.id
        let token = authenticated ? await tokens.accessToken : nil
        guard generation == sessionGeneration else { throw CancellationError() }
        let request = try makeRequest(
            path: path, method: method, query: query, body: body, accessToken: token
        )

        let (data, response) = try await send(request)
        guard generation == sessionGeneration else { throw CancellationError() }

        guard response.statusCode == 401, authenticated, allowRefresh else {
            return try validate(data: data, response: response)
        }

        // 401 — refresh once, then retry exactly once. A second 401 after a
        // successful refresh is a real authorization failure, not a stale
        // token, so it is surfaced rather than looped on.
        guard try await refreshSession(after: previousRefreshID) else {
            throw try mapError(data: data, status: response.statusCode)
        }

        guard generation == sessionGeneration else { throw CancellationError() }
        let retryToken = await tokens.accessToken
        guard generation == sessionGeneration else { throw CancellationError() }
        let retried = try makeRequest(
            path: path, method: method, query: query, body: body, accessToken: retryToken
        )
        let (retryData, retryResponse) = try await send(retried)
        guard generation == sessionGeneration else { throw CancellationError() }
        return try validate(data: retryData, response: retryResponse)
    }

    private func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw APIError.unparsable(status: 0)
            }
            return (data, http)
        } catch let error as URLError {
            throw APIError.offline(error)
        }
    }

    private func validate(data: Data, response: HTTPURLResponse) throws -> Data {
        guard (200..<300).contains(response.statusCode) else {
            let error = try mapError(data: data, status: response.statusCode)
            if error.is(.passwordChangeRequired) {
                // Fire and forget: the caller still gets the error, and the
                // app independently flips into the forced-change state.
                let notify = onPasswordChangeRequired
                Task { await notify() }
            }
            throw error
        }
        return data
    }

    /// Maps an error response body to `APIError`.
    ///
    /// A body that does not parse still produces a usable error: a 500 from a
    /// crashed process or a proxy often arrives as HTML, and surfacing "the
    /// data couldn't be read" would tell the user nothing about what happened.
    private func mapError(data: Data, status: Int) throws -> APIError {
        guard let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data) else {
            return APIError.unparsable(status: status)
        }
        // The code is kept as the server sent it, even when unrecognized, so
        // its message survives rather than collapsing to a generic string
        // (C17).
        return APIError(status: status, code: envelope.error.code, message: envelope.error.message)
    }

    // MARK: - Single-flight refresh (C18)

    /// Refreshes the session, coalescing concurrent callers onto one attempt.
    ///
    /// Refresh tokens rotate on use, and the server treats reuse of a rotated
    /// token as theft and revokes the entire family. Two parallel refreshes
    /// would therefore sign the user out — the web app hit exactly this under
    /// React StrictMode.
    ///
    /// Being an actor method, the check-and-set below cannot interleave: a
    /// second caller entering while the first is suspended finds the task
    /// already stored and awaits it.
    private func refreshSession(after previousID: UUID?) async throws -> Bool {
        if let completedRefresh, completedRefresh.id != previousID {
            return try completedRefresh.result.get()
        }
        if let existing = refreshTask {
            return try await existing.value
        }

        let generation = sessionGeneration
        let taskID = UUID()
        let task = Task<Bool, Error> { [tokens, onSessionExpired] in
            let storedRefreshToken = await tokens.refreshToken
            guard generation == sessionGeneration else { throw CancellationError() }
            guard let refreshToken = storedRefreshToken else {
                await tokens.clear()
                await onSessionExpired()
                return false
            }
            do {
                let body = try encoder.encode(RefreshRequest(refreshToken: refreshToken))
                let data = try await perform(
                    path: "auth/refresh",
                    method: .post,
                    body: body,
                    authenticated: false,
                    allowRefresh: false
                )
                let session = try decoder.decode(SessionResult.self, from: data)
                guard generation == sessionGeneration else { throw CancellationError() }
                try await tokens.store(session)
                guard generation == sessionGeneration else { throw CancellationError() }
                await onSessionUpdated(session.user)
                return true
            } catch let error as APIError where error.is(.network) {
                guard generation == sessionGeneration else { throw CancellationError() }
                // A lost connection/timeout does not establish that the token
                // was rejected, nor that the server never rotated it. Preserve
                // credentials and the exact transport error for every waiter.
                // No automatic replay: a later caller may attempt recovery.
                throw error
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                guard generation == sessionGeneration else { throw CancellationError() }
                // Preserve the existing fail-closed path for rejected or
                // unusable refresh responses. In particular, never replay a
                // token the server explicitly revoked or rejected.
                await tokens.clear()
                await onSessionExpired()
                return false
            }
        }

        refreshTask = task
        refreshTaskID = taskID
        defer {
            // An old flight must not erase a newer account's in-flight refresh.
            if refreshTaskID == taskID {
                refreshTask = nil
                refreshTaskID = nil
            }
        }
        let result = await task.result
        guard generation == sessionGeneration else { throw CancellationError() }
        completedRefresh = (taskID, result)
        return try result.get()
    }

    // MARK: - Decoding helpers

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try decoder.decode(type, from: data)
        } catch {
            // A response that does not match the contract is a server or
            // contract bug, not something the user can act on — but it must
            // still surface as an APIError rather than a raw DecodingError,
            // so the UI has a message to show.
            throw APIError(
                status: 200,
                code: KnownErrorCode.internalError.rawValue,
                message: "The server sent something unexpected. Please try again."
            )
        }
    }

    private func requestJSON<T: Decodable>(
        _ type: T.Type,
        path: String,
        method: Method = .get,
        query: [URLQueryItem] = [],
        body: (any Encodable)? = nil
    ) async throws -> T {
        let encoded = try body.map { try encoder.encode($0) }
        let data = try await perform(path: path, method: method, query: query, body: encoded)
        return try decode(type, from: data)
    }

    /// For `DELETE` and `logout`, which answer 204 with no body. Decoding
    /// anything here would throw on the empty data.
    private func requestVoid(
        path: String,
        method: Method,
        body: (any Encodable)? = nil
    ) async throws {
        let encoded = try body.map { try encoder.encode($0) }
        _ = try await perform(path: path, method: method, body: encoded)
    }

    // MARK: - Auth

    func login(email: String, password: String) async throws -> SessionResult {
        sessionGeneration = UUID()
        refreshTask?.cancel()
        refreshTask = nil
        refreshTaskID = nil
        completedRefresh = nil
        let body = try encoder.encode(LoginRequest(email: email, password: password))
        let data = try await perform(
            path: "auth/login", method: .post, body: body,
            authenticated: false, allowRefresh: false
        )
        let session = try decode(SessionResult.self, from: data)
        try await tokens.store(session)
        return session
    }

    /// Best-effort revocation, then an unconditional local clear (C21).
    ///
    /// Deliberately does not rethrow a failed revocation. A sign-out that
    /// reports failure while the user is, locally, signed out is worse than
    /// silence: there is nothing they can do about it, and the server-side
    /// token expires on its own. What must never happen is the opposite —
    /// returning while the credentials are still on the device.
    ///
    /// The clear is awaited rather than fired off in a `defer`, so a caller
    /// that checks `hasSession` immediately afterwards sees the truth.
    func logout() async throws {
        sessionGeneration = UUID()
        refreshTask?.cancel()
        refreshTask = nil
        refreshTaskID = nil
        completedRefresh = nil
        if let refreshToken = await tokens.refreshToken {
            try? await requestVoid(
                path: "auth/logout", method: .post, body: LogoutRequest(refreshToken: refreshToken)
            )
        }
        await tokens.clear()
    }

    func changePassword(currentPassword: String, newPassword: String) async throws -> SessionResult {
        let session: SessionResult = try await requestJSON(
            SessionResult.self,
            path: "auth/change-password",
            method: .post,
            body: ChangePasswordRequest(
                currentPassword: currentPassword, newPassword: newPassword
            )
        )
        // The server revokes every other refresh token on a password change,
        // so the one in this response is the only live credential.
        try await tokens.store(session)
        return session
    }

    func me() async throws -> PublicUser {
        try await requestJSON(PublicUser.self, path: "me")
    }

    // MARK: - Events

    func listEvents(start: Date, end: Date) async throws -> [CalendarEvent] {
        let response: ListEventsResponse = try await requestJSON(
            ListEventsResponse.self,
            path: "events",
            query: [
                URLQueryItem(name: "start", value: APICoding.iso(from: start)),
                URLQueryItem(name: "end", value: APICoding.iso(from: end)),
            ]
        )
        return response.events
    }

    func createEvent(_ body: CreateEventRequest) async throws -> CalendarEvent {
        try await requestJSON(CalendarEvent.self, path: "events", method: .post, body: body)
    }

    func getEvent(id: String) async throws -> CalendarEvent {
        try await requestJSON(CalendarEvent.self, path: "events/\(id)")
    }

    func updateEvent(id: String, _ body: UpdateEventRequest) async throws -> CalendarEvent {
        try await requestJSON(
            CalendarEvent.self, path: "events/\(id)", method: .patch, body: body
        )
    }

    func deleteEvent(id: String) async throws {
        try await requestVoid(path: "events/\(id)", method: .delete)
    }

    // MARK: - Announcements

    func listAnnouncements(limit: Int?, cursor: String?) async throws -> AnnouncementPage {
        var query: [URLQueryItem] = []
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await requestJSON(AnnouncementPage.self, path: "announcements", query: query)
    }

    func createAnnouncement(body: String) async throws -> Announcement {
        try await requestJSON(
            Announcement.self, path: "announcements", method: .post,
            body: CreateAnnouncementRequest(body: body)
        )
    }

    func updateAnnouncement(id: String, body: String) async throws -> Announcement {
        try await requestJSON(
            Announcement.self, path: "announcements/\(id)", method: .patch,
            body: UpdateAnnouncementRequest(body: body)
        )
    }

    func deleteAnnouncement(id: String) async throws {
        try await requestVoid(path: "announcements/\(id)", method: .delete)
    }

    // MARK: - Quick tips

    func listQuickTips() async throws -> [QuickTip] {
        let response: ListQuickTipsResponse = try await requestJSON(
            ListQuickTipsResponse.self, path: "quick-tips"
        )
        return response.quickTips
    }

    func createQuickTip(_ body: CreateQuickTipRequest) async throws -> QuickTip {
        try await requestJSON(QuickTip.self, path: "quick-tips", method: .post, body: body)
    }

    func updateQuickTip(id: String, _ body: UpdateQuickTipRequest) async throws -> QuickTip {
        try await requestJSON(QuickTip.self, path: "quick-tips/\(id)", method: .patch, body: body)
    }

    func deleteQuickTip(id: String) async throws {
        try await requestVoid(path: "quick-tips/\(id)", method: .delete)
    }

    // MARK: - Knowledge base

    func listCategories() async throws -> [InfoCategory] {
        let response: ListCategoriesResponse = try await requestJSON(
            ListCategoriesResponse.self, path: "info/categories"
        )
        return response.categories
    }

    func createCategory(_ body: CreateCategoryRequest) async throws -> InfoCategory {
        try await requestJSON(
            InfoCategory.self, path: "info/categories", method: .post, body: body
        )
    }

    func updateCategory(id: String, _ body: UpdateCategoryRequest) async throws -> InfoCategory {
        try await requestJSON(
            InfoCategory.self, path: "info/categories/\(id)", method: .patch, body: body
        )
    }

    func deleteCategory(id: String) async throws {
        try await requestVoid(path: "info/categories/\(id)", method: .delete)
    }

    func listArticles(categoryID: String) async throws -> [ArticleSummary] {
        let response: ListArticleSummariesResponse = try await requestJSON(
            ListArticleSummariesResponse.self, path: "info/categories/\(categoryID)/articles"
        )
        return response.articles
    }

    func getArticle(id: String) async throws -> InfoArticle {
        try await requestJSON(InfoArticle.self, path: "info/articles/\(id)")
    }

    func createArticle(_ body: CreateArticleRequest) async throws -> InfoArticle {
        try await requestJSON(InfoArticle.self, path: "info/articles", method: .post, body: body)
    }

    func updateArticle(id: String, _ body: UpdateArticleRequest) async throws -> InfoArticle {
        try await requestJSON(
            InfoArticle.self, path: "info/articles/\(id)", method: .patch, body: body
        )
    }

    func deleteArticle(id: String) async throws {
        try await requestVoid(path: "info/articles/\(id)", method: .delete)
    }

    // MARK: - Uploads

    func presignUpload(_ body: PresignUploadRequest) async throws -> PresignUploadResponse {
        try await requestJSON(
            PresignUploadResponse.self, path: "uploads/presign", method: .post, body: body
        )
    }
}
