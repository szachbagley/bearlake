//
//  TokenStore.swift
//  bearlake-client
//

import Foundation

/// Holds the session's credentials.
///
/// An `actor` because the access token is read and rewritten from every
/// concurrent request, and the single-flight refresh (C18) depends on those
/// reads and writes being serialised. A plain class guarded by nothing would
/// let two requests observe a stale token and each start its own refresh —
/// which, because refresh tokens rotate, makes the server treat the second as
/// theft and revoke the whole family.
actor TokenStore {
    /// In memory only, never persisted (C20). It expires in under an hour, so
    /// writing it to disk adds exposure and buys nothing.
    private(set) var accessToken: String?

    private let secureStore: SecureStore
    private let key: String

    init(
        secureStore: SecureStore = KeychainStore(),
        key: String = KeychainStore.refreshTokenKey
    ) {
        self.secureStore = secureStore
        self.key = key
    }

    /// Read from the Keychain on demand rather than cached, so an external
    /// clear (another process, a restore) cannot leave a stale copy behind.
    var refreshToken: String? {
        secureStore.read(key)
    }

    var hasSession: Bool { refreshToken != nil }

    /// Stores both halves of a session. Called on login, on refresh (the
    /// token rotates every time), and on password change.
    func store(_ session: SessionResult) throws {
        accessToken = session.accessToken
        try secureStore.save(session.refreshToken, for: key)
    }

    func setAccessToken(_ token: String?) {
        accessToken = token
    }

    /// Wipes both halves. Must succeed even when nothing is stored — a failed
    /// sign-out that leaves the user apparently signed in is worse than the
    /// error it reports (C21).
    func clear() {
        accessToken = nil
        try? secureStore.delete(key)
    }
}
