//
//  APIClientTests.swift
//  bearlake-clientTests
//

import Foundation
import Testing
@testable import bearlake_client

private let baseURL = URL(string: "https://api.test/api/v1")!

private func json(_ string: String) -> Data { Data(string.utf8) }

private func makeClient(
    state: StubState,
    store: InMemorySecureStore = InMemorySecureStore(),
    onExpired: @escaping @Sendable () async -> Void = {}
) -> (APIClient, TokenStore) {
    let tokens = TokenStore(secureStore: store, key: "refresh")
    let client = APIClient(
        baseURL: baseURL,
        session: TestSession.make(state),
        tokens: tokens,
        onSessionExpired: onExpired
    )
    return (client, tokens)
}

private let userJSON = """
{"id":"u1","displayName":"Zach","email":"z@example.com","role":"admin",
 "mustChangePassword":false,"isActive":true,"lastLoginAt":null,
 "createdAt":"2026-08-01T12:00:00.000Z","updatedAt":"2026-08-01T12:00:00.000Z"}
"""

// MARK: - Envelopes

struct EnvelopeTests {
    @Test("a named-wrapper list unwraps to its array")
    func unwrapsNamedList() async throws {
        let state = StubState()
        state.setHandler { _ in
            .init(status: 200, body: json("""
            {"quickTips":[{"id":"q1","body":"Gate code","sortOrder":0,"createdBy":"u1",
             "createdAt":"2026-08-01T12:00:00.000Z","updatedAt":"2026-08-01T12:00:00.000Z"}]}
            """))
        }
        let (client, _) = makeClient(state: state)
        let tips = try await client.listQuickTips()
        #expect(tips.count == 1)
        #expect(tips.first?.body == "Gate code")
    }

    @Test("a bare object decodes directly")
    func decodesBareObject() async throws {
        let state = StubState()
        state.setHandler { _ in .init(status: 200, body: json(userJSON)) }
        let (client, _) = makeClient(state: state)
        let user = try await client.me()
        #expect(user.displayName == "Zach")
        #expect(user.isAdmin)
    }

    /// A 204 carries no body. Attempting to decode one is the bug this
    /// guards — it would surface as "the data couldn't be read" on every
    /// successful delete.
    @Test("a 204 with an empty body succeeds instead of failing to decode")
    func handles204() async throws {
        let state = StubState()
        state.setHandler { _ in .init(status: 204, body: Data()) }
        let (client, _) = makeClient(state: state)
        try await client.deleteEvent(id: "e1")
        #expect(state.count(path: "/events/e1") == 1)
    }

    @Test("the events range query sends both bounds")
    func sendsRangeQuery() async throws {
        let state = StubState()
        state.setHandler { _ in .init(status: 200, body: json(#"{"events":[]}"#)) }
        let (client, _) = makeClient(state: state)
        _ = try await client.listEvents(
            start: Date(timeIntervalSince1970: 1_785_585_600),
            end: Date(timeIntervalSince1970: 1_788_264_000)
        )
        let query = state.requests.first?.url?.query ?? ""
        #expect(query.contains("start="))
        #expect(query.contains("end="))
    }

    @Test("a JSON body is sent with a JSON content type")
    func sendsJSONHeaders() async throws {
        let state = StubState()
        state.setHandler { _ in
            .init(status: 200, body: json("""
            {"id":"a1","body":"Hi","postedAt":"2026-08-01T12:00:00.000Z","createdBy":"u1",
             "createdAt":"2026-08-01T12:00:00.000Z","updatedAt":"2026-08-01T12:00:00.000Z"}
            """))
        }
        let (client, _) = makeClient(state: state)
        _ = try await client.createAnnouncement(body: "Hi")
        let request = try #require(state.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
    }
}

// MARK: - Errors

struct ErrorMappingTests {
    @Test("an error envelope maps to its code and status")
    func mapsErrorEnvelope() async throws {
        let state = StubState()
        state.setHandler { _ in
            .init(status: 403, body: json(
                #"{"error":{"code":"FORBIDDEN","message":"Only an admin can do that."}}"#))
        }
        let (client, _) = makeClient(state: state)

        await #expect(throws: APIError.self) { try await client.me() }
        do {
            _ = try await client.me()
        } catch let error as APIError {
            #expect(error.status == 403)
            #expect(error.is(.forbidden))
            #expect(error.message == "Only an admin can do that.")
        }
    }

    /// C17 — the server may add a code before this build is replaced. Its
    /// message must survive rather than collapsing into a generic string.
    @Test("an unrecognized code keeps the server's message")
    func keepsUnknownCodeMessage() async throws {
        let state = StubState()
        state.setHandler { _ in
            .init(status: 418, body: json(
                #"{"error":{"code":"SEASONAL_CLOSURE","message":"The cabin is closed until May."}}"#))
        }
        let (client, _) = makeClient(state: state)
        do {
            _ = try await client.me()
            Issue.record("expected a failure")
        } catch let error as APIError {
            #expect(error.code == "SEASONAL_CLOSURE")
            #expect(error.known == nil)
            #expect(error.message == "The cabin is closed until May.")
        }
    }

    /// A crashed process or a proxy answers with HTML, not the error
    /// envelope. Surfacing a decode failure there tells the user nothing.
    @Test("a non-JSON 500 still yields INTERNAL with a usable message")
    func mapsNonJSON500() async throws {
        let state = StubState()
        state.setHandler { _ in
            .init(status: 500, body: json("<html><body>502 Bad Gateway</body></html>"))
        }
        let (client, _) = makeClient(state: state)
        do {
            _ = try await client.me()
            Issue.record("expected a failure")
        } catch let error as APIError {
            #expect(error.is(.internalError))
            #expect(error.status == 500)
            #expect(error.message.isEmpty == false)
        }
    }

    @Test("a transport failure maps to a friendly offline error")
    func mapsTransportFailure() async throws {
        let tokens = TokenStore(secureStore: InMemorySecureStore(), key: "refresh")
        let client = APIClient(baseURL: baseURL, session: TestSession.offline(), tokens: tokens)
        do {
            _ = try await client.me()
            Issue.record("expected a failure")
        } catch let error as APIError {
            #expect(error.is(.network))
            #expect(error.status == 0)
            #expect(error.message.contains("offline"))
        }
    }

    @Test("a success body that does not match the contract is an APIError, not a DecodingError")
    func mapsDecodeFailure() async throws {
        let state = StubState()
        state.setHandler { _ in .init(status: 200, body: json(#"{"unexpected":true}"#)) }
        let (client, _) = makeClient(state: state)
        do {
            _ = try await client.me()
            Issue.record("expected a failure")
        } catch let error as APIError {
            #expect(error.is(.internalError))
        }
    }
}

// MARK: - Single-flight refresh (C18)

struct RefreshTests {
    /// Answers 401 to protected calls until a refresh succeeds, then 200.
    private func makeRefreshingState(refreshStatus: Int = 200) -> StubState {
        let state = StubState()
        let refreshed = LockedFlag()
        state.setHandler { request in
            let path = request.url?.path ?? ""
            if path.hasSuffix("/auth/refresh") {
                guard refreshStatus == 200 else {
                    return .init(status: refreshStatus, body: json(
                        #"{"error":{"code":"UNAUTHENTICATED","message":"Session expired."}}"#))
                }
                refreshed.set()
                return .init(status: 200, body: json("""
                {"accessToken":"new","refreshToken":"rotated","user":\(userJSON)}
                """))
            }
            guard refreshed.value else {
                return .init(status: 401, body: json(
                    #"{"error":{"code":"UNAUTHENTICATED","message":"Token expired."}}"#))
            }
            return .init(status: 200, body: json(userJSON))
        }
        return state
    }

    @Test("one 401 triggers exactly one refresh and one retry")
    func singleRefreshOnOne401() async throws {
        let state = makeRefreshingState()
        let store = InMemorySecureStore()
        try store.save("original", for: "refresh")
        let (client, tokens) = makeClient(state: state, store: store)

        let user = try await client.me()
        #expect(user.displayName == "Zach")
        #expect(state.count(path: "/auth/refresh") == 1)
        #expect(state.count(path: "/me") == 2, "one 401 then one retry")
        // The rotated token replaced the original.
        #expect(await tokens.refreshToken == "rotated")
    }

    /// The bug the web app shipped under React StrictMode. Refresh tokens
    /// rotate, and the server treats reuse of a rotated token as theft and
    /// revokes the whole family — so two parallel refreshes sign the user out.
    @Test("concurrent 401s trigger exactly one refresh")
    func concurrent401sRefreshOnce() async throws {
        let state = makeRefreshingState()
        let store = InMemorySecureStore()
        try store.save("original", for: "refresh")
        let (client, _) = makeClient(state: state, store: store)

        async let first = client.me()
        async let second = client.me()
        async let third = client.me()
        async let fourth = client.me()
        let results = try await [first, second, third, fourth]

        #expect(results.count == 4)
        #expect(
            state.count(path: "/auth/refresh") == 1,
            "four concurrent 401s must coalesce onto one refresh, not four"
        )
    }

    @Test("a failed refresh clears the session and does not retry again")
    func failedRefreshClearsSession() async throws {
        let state = makeRefreshingState(refreshStatus: 401)
        let store = InMemorySecureStore()
        try store.save("original", for: "refresh")

        let expired = LockedFlag()
        let (client, tokens) = makeClient(state: state, store: store) { expired.set() }

        do {
            _ = try await client.me()
            Issue.record("expected a failure")
        } catch let error as APIError {
            #expect(error.status == 401)
        }

        #expect(state.count(path: "/auth/refresh") == 1)
        #expect(state.count(path: "/me") == 1, "must not retry after a failed refresh")
        #expect(await tokens.refreshToken == nil, "the dead refresh token must be cleared")
        #expect(await tokens.accessToken == nil)
        #expect(expired.value, "the app must be told to route to login")
    }

    @Test("a 401 with no refresh token at all clears and reports expiry")
    func no401RecoveryWithoutToken() async throws {
        let state = StubState()
        state.setHandler { _ in
            .init(status: 401, body: json(
                #"{"error":{"code":"UNAUTHENTICATED","message":"No session."}}"#))
        }
        let expired = LockedFlag()
        let (client, _) = makeClient(state: state, store: InMemorySecureStore()) { expired.set() }

        await #expect(throws: APIError.self) { try await client.me() }
        #expect(state.count(path: "/auth/refresh") == 0, "nothing to refresh with")
        #expect(expired.value)
    }

    /// A 401 after a successful refresh is a real authorization failure, not
    /// a stale token, so it must surface rather than loop.
    @Test("a second 401 after refreshing is surfaced, not retried forever")
    func doesNotLoopOnPersistent401() async throws {
        let state = StubState()
        state.setHandler { request in
            if request.url?.path.hasSuffix("/auth/refresh") == true {
                return .init(status: 200, body: json("""
                {"accessToken":"new","refreshToken":"rotated","user":\(userJSON)}
                """))
            }
            return .init(status: 401, body: json(
                #"{"error":{"code":"FORBIDDEN","message":"Not allowed."}}"#))
        }
        let store = InMemorySecureStore()
        try store.save("original", for: "refresh")
        let (client, _) = makeClient(state: state, store: store)

        await #expect(throws: APIError.self) { try await client.me() }
        #expect(state.count(path: "/auth/refresh") == 1)
        #expect(state.count(path: "/me") == 2, "original plus exactly one retry")
    }

    @Test("login and refresh never carry an Authorization header")
    func authEndpointsSkipBearer() async throws {
        let state = StubState()
        state.setHandler { _ in
            .init(status: 200, body: json("""
            {"accessToken":"a","refreshToken":"r","user":\(userJSON)}
            """))
        }
        let (client, _) = makeClient(state: state)
        _ = try await client.login(email: "z@example.com", password: "password1234")
        let request = try #require(state.requests.first)
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
    }

    @Test("an authenticated call sends the bearer token")
    func sendsBearer() async throws {
        let state = StubState()
        state.setHandler { _ in .init(status: 200, body: json(userJSON)) }
        let store = InMemorySecureStore()
        let (client, tokens) = makeClient(state: state, store: store)
        await tokens.setAccessToken("token-123")

        _ = try await client.me()
        let request = try #require(state.requests.first)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer token-123")
    }
}

// MARK: - Session storage

struct TokenStoreTests {
    @Test("storing a session keeps the access token in memory and the refresh token in the store")
    func storesBothHalves() async throws {
        let store = InMemorySecureStore()
        let tokens = TokenStore(secureStore: store, key: "refresh")
        try await tokens.store(
            SessionResult(accessToken: "access", refreshToken: "refresh-value",
                          user: PublicUser.fixture())
        )
        #expect(await tokens.accessToken == "access")
        #expect(store.read("refresh") == "refresh-value")
        #expect(await tokens.hasSession)
    }

    @Test("clear wipes both halves")
    func clearWipesBoth() async throws {
        let store = InMemorySecureStore()
        let tokens = TokenStore(secureStore: store, key: "refresh")
        try await tokens.store(
            SessionResult(accessToken: "a", refreshToken: "r", user: PublicUser.fixture())
        )
        await tokens.clear()
        #expect(await tokens.accessToken == nil)
        #expect(await tokens.refreshToken == nil)
        #expect(store.isEmpty)
    }

    /// Sign-out must not throw because the user was already signed out (C21).
    @Test("clearing an empty store is not an error")
    func clearIsIdempotent() async {
        let tokens = TokenStore(secureStore: InMemorySecureStore(), key: "refresh")
        await tokens.clear()
        await tokens.clear()
        #expect(await tokens.hasSession == false)
    }

    /// The refresh token is read through on every access rather than cached,
    /// so an external clear cannot leave a stale copy behind.
    @Test("the refresh token is read through to the store")
    func readsThrough() async throws {
        let store = InMemorySecureStore()
        let tokens = TokenStore(secureStore: store, key: "refresh")
        #expect(await tokens.refreshToken == nil)
        try store.save("external", for: "refresh")
        #expect(await tokens.refreshToken == "external")
        try store.delete("refresh")
        #expect(await tokens.refreshToken == nil)
    }
}

/// The real Keychain, exercised once to prove the wrapper works against the
/// actual API rather than only against the in-memory double.
struct KeychainStoreTests {
    @Test("save, read, overwrite, delete")
    func roundTrip() throws {
        let store = KeychainStore(service: "bearlake.tests.\(UUID().uuidString)")
        let key = "refresh"

        #expect(store.read(key) == nil)

        try store.save("first", for: key)
        #expect(store.read(key) == "first")

        // Overwrite must update in place; SecItemAdd on a duplicate returns
        // errSecDuplicateItem rather than replacing.
        try store.save("second", for: key)
        #expect(store.read(key) == "second")

        try store.delete(key)
        #expect(store.read(key) == nil)

        // Deleting what is already gone is the desired end state.
        try store.delete(key)
    }
}

// MARK: - Helper

/// A boolean safe to set from the stub's queues and read from the test.
final class LockedFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var flag = false
    func set() { lock.lock(); flag = true; lock.unlock() }
    var value: Bool { lock.lock(); defer { lock.unlock() }; return flag }
}

// MARK: - Logout (C21)

struct LogoutTests {
    @Test("logout revokes server-side and clears locally")
    func revokesAndClears() async throws {
        let state = StubState()
        state.setHandler { _ in .init(status: 204, body: Data()) }
        let store = InMemorySecureStore()
        try store.save("refresh-value", for: "refresh")
        let (client, tokens) = makeClient(state: state, store: store)
        await tokens.setAccessToken("access")

        try await client.logout()

        #expect(state.count(path: "/auth/logout") == 1)
        #expect(await tokens.refreshToken == nil)
        #expect(await tokens.accessToken == nil)
    }

    /// The failure that matters: a dropped connection must not leave the user
    /// apparently signed in. Checked synchronously right after the call
    /// returns — an earlier version cleared inside a `defer { Task { … } }`,
    /// which returned before the clear had run.
    @Test("a failed revocation still clears the session")
    func clearsEvenWhenRevocationFails() async throws {
        let store = InMemorySecureStore()
        try store.save("refresh-value", for: "refresh")
        let tokens = TokenStore(secureStore: store, key: "refresh")
        await tokens.setAccessToken("access")
        let client = APIClient(
            baseURL: baseURL, session: TestSession.offline(), tokens: tokens
        )

        try await client.logout()

        #expect(await tokens.refreshToken == nil)
        #expect(await tokens.accessToken == nil)
        #expect(await tokens.hasSession == false)
        #expect(store.isEmpty)
    }

    @Test("a 500 from logout still clears the session")
    func clearsOnServerError() async throws {
        let state = StubState()
        state.setHandler { _ in
            .init(status: 500, body: Data(#"{"error":{"code":"INTERNAL","message":"boom"}}"#.utf8))
        }
        let store = InMemorySecureStore()
        try store.save("refresh-value", for: "refresh")
        let (client, tokens) = makeClient(state: state, store: store)

        try await client.logout()
        #expect(await tokens.hasSession == false)
    }

    @Test("logging out with no session is a no-op, not an error")
    func logoutWithoutSession() async throws {
        let state = StubState()
        state.setHandler { _ in .init(status: 204, body: Data()) }
        let (client, tokens) = makeClient(state: state)

        try await client.logout()
        #expect(state.count(path: "/auth/logout") == 0, "nothing to revoke")
        #expect(await tokens.hasSession == false)
    }
}

// MARK: - Password-change gate interception (Phase 3 step 4)

struct PasswordGateTests {
    /// The gate is not only a login-time condition: an admin can reset a
    /// user's password while that user has the app open, and every
    /// subsequent request then 403s with this code.
    @Test("PASSWORD_CHANGE_REQUIRED from any route notifies the app")
    func interceptsGateCode() async throws {
        let state = StubState()
        state.setHandler { _ in
            .init(status: 403, body: json("""
            {"error":{"code":"PASSWORD_CHANGE_REQUIRED","message":"Change your password first."}}
            """))
        }
        let flagged = LockedFlag()
        let tokens = TokenStore(secureStore: InMemorySecureStore(), key: "refresh")
        let client = APIClient(
            baseURL: baseURL,
            session: TestSession.make(state),
            tokens: tokens,
            onPasswordChangeRequired: { flagged.set() }
        )
        await tokens.setAccessToken("token")

        // The caller still receives the error…
        do {
            _ = try await client.listQuickTips()
            Issue.record("expected a failure")
        } catch let error as APIError {
            #expect(error.is(.passwordChangeRequired))
        }

        // …and the app is told independently. The notification is fired off
        // rather than awaited, so give it a moment to land.
        try await Task.sleep(for: .milliseconds(200))
        #expect(flagged.value, "the app must flip into the forced-change state")
    }

    @Test("an ordinary 403 does not trip the gate")
    func ignoresPlainForbidden() async throws {
        let state = StubState()
        state.setHandler { _ in
            .init(status: 403, body: json(
                #"{"error":{"code":"FORBIDDEN","message":"Only an admin can do that."}}"#))
        }
        let flagged = LockedFlag()
        let tokens = TokenStore(secureStore: InMemorySecureStore(), key: "refresh")
        let client = APIClient(
            baseURL: baseURL, session: TestSession.make(state), tokens: tokens,
            onPasswordChangeRequired: { flagged.set() }
        )
        await tokens.setAccessToken("token")

        await #expect(throws: APIError.self) { try await client.listQuickTips() }
        try await Task.sleep(for: .milliseconds(200))
        #expect(flagged.value == false)
    }
}

// MARK: - Announcement request shapes (C15)

struct AnnouncementRequestShapeTests {
    private func capturedBody(_ state: StubState) throws -> [String: Any] {
        let request = try #require(state.requests.first)
        // URLProtocol moves a streamed body off httpBody, so read either.
        let data = try #require(
            request.httpBody ?? request.httpBodyStream.map { stream -> Data in
                stream.open()
                defer { stream.close() }
                var buffer = [UInt8](repeating: 0, count: 8192)
                var collected = Data()
                while stream.hasBytesAvailable {
                    let read = stream.read(&buffer, maxLength: buffer.count)
                    if read <= 0 { break }
                    collected.append(contentsOf: buffer[0..<read])
                }
                return collected
            }
        )
        return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private let announcementJSON = """
    {"id":"a1","body":"Hi","postedAt":"2026-08-01T12:00:00.000Z","createdBy":"u1",
     "createdAt":"2026-08-01T12:00:00.000Z","updatedAt":"2026-08-01T12:00:00.000Z"}
    """

    @Test("create sends exactly body")
    func createSendsOnlyBody() async throws {
        let state = StubState()
        state.setHandler { _ in .init(status: 200, body: json(announcementJSON)) }
        let (client, _) = makeClient(state: state)

        _ = try await client.createAnnouncement(body: "Marina code is 0000")

        #expect(try Set(capturedBody(state).keys) == ["body"])
    }

    /// `postedAt` is displayed but never editable — the server sets it, and
    /// sending it back is a 400 under the strict-body rule.
    @Test("update sends exactly body, never postedAt")
    func updateSendsOnlyBody() async throws {
        let state = StubState()
        state.setHandler { _ in .init(status: 200, body: json(announcementJSON)) }
        let (client, _) = makeClient(state: state)

        _ = try await client.updateAnnouncement(id: "a1", body: "Corrected text")

        let fields = try capturedBody(state)
        #expect(Set(fields.keys) == ["body"])
        #expect(fields["postedAt"] == nil)
        #expect(fields["id"] == nil)
    }

    @Test("delete sends no body and uses DELETE")
    func deleteSendsNoBody() async throws {
        let state = StubState()
        state.setHandler { _ in .init(status: 204, body: Data()) }
        let (client, _) = makeClient(state: state)

        try await client.deleteAnnouncement(id: "a1")

        let request = try #require(state.requests.first)
        #expect(request.httpMethod == "DELETE")
        #expect(request.httpBody == nil)
        #expect(request.url?.path.hasSuffix("/announcements/a1") == true)
    }
}
