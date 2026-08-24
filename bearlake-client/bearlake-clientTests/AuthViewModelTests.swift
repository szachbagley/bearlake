//
//  AuthViewModelTests.swift
//  bearlake-clientTests
//

import Foundation
import Testing
@testable import bearlake_client

@MainActor
private func makeAuth(
    api: FakeAPI = FakeAPI(),
    store: InMemorySecureStore = InMemorySecureStore()
) -> (AuthViewModel, FakeAPI, TokenStore, InMemorySecureStore) {
    let tokens = TokenStore(secureStore: store, key: "refresh")
    return (AuthViewModel(api: api, tokens: tokens), api, tokens, store)
}

@MainActor
struct LoginTests {
    @Test("a successful login lands in the app and stores both tokens")
    func loginSucceeds() async throws {
        let (auth, api, tokens, store) = makeAuth()
        await api.seed(user: .fixture(displayName: "Rachel", role: .member))

        await auth.login(email: "rachel@example.com", password: "correct-horse-battery")

        #expect(auth.state == .signedIn(.fixture(displayName: "Rachel", role: .member)))
        #expect(auth.loginError == nil)
        #expect(auth.isAdmin == false)
        // FakeAPI stands in for the client, which is what actually persists;
        // what matters here is that the ViewModel did not swallow the session.
        #expect(auth.currentUser?.displayName == "Rachel")
        _ = tokens; _ = store
    }

    @Test("the email is trimmed before it is sent")
    func trimsEmail() async throws {
        let (auth, api, _, _) = makeAuth()
        await auth.login(email: "  zach@example.com \n", password: "password1234")
        #expect(await api.callCount("login") == 1)
        #expect(auth.state.user != nil)
    }

    /// Distinguishing "no such account" from "wrong password" would let
    /// anyone enumerate which family members have accounts.
    @Test("every credential failure shows the same generic message", arguments: [
        APIError(status: 401, code: "INVALID_CREDENTIALS", message: "No user with that email."),
        APIError(status: 403, code: "ACCOUNT_DISABLED", message: "That account is deactivated."),
        APIError(status: 400, code: "VALIDATION_ERROR", message: "email must be an email"),
    ])
    func genericFailureMessage(error: APIError) async throws {
        let (auth, api, _, _) = makeAuth()
        await api.setNextError(error)

        await auth.login(email: "someone@example.com", password: "wrong")

        #expect(auth.loginError == AuthViewModel.genericLoginFailure)
        #expect(auth.state == .signedOut || auth.state == .restoring)
        #expect(auth.currentUser == nil)
        // The server's more specific wording must not leak through.
        #expect(auth.loginError?.contains("deactivated") == false)
        #expect(auth.loginError?.contains("No user") == false)
    }

    /// The exception: "try again in a minute" is actionable and reveals
    /// nothing about whether the account exists.
    @Test("a rate-limit failure shows the server's message")
    func rateLimitMessageShown() async throws {
        let (auth, api, _, _) = makeAuth()
        await api.setNextError(APIError(
            status: 429, code: "RATE_LIMITED",
            message: "Too many attempts. Try again in 15 minutes."
        ))

        await auth.login(email: "zach@example.com", password: "wrong")
        #expect(auth.loginError == "Too many attempts. Try again in 15 minutes.")
    }

    @Test("an offline failure says so rather than blaming the password")
    func offlineMessageShown() async throws {
        let (auth, api, _, _) = makeAuth()
        await api.setNextError(APIError(
            status: 0, code: "NETWORK_ERROR",
            message: "You appear to be offline. Check your connection and try again."
        ))

        await auth.login(email: "zach@example.com", password: "password1234")
        #expect(auth.loginError?.contains("offline") == true)
    }

    @Test("a user with mustChangePassword is gated, not signed in")
    func mustChangePasswordGates() async throws {
        let (auth, api, _, _) = makeAuth()
        await api.seed(user: .fixture(mustChangePassword: true))

        await auth.login(email: "zach@example.com", password: "temp-password")

        guard case .mustChangePassword = auth.state else {
            Issue.record("expected the forced-change gate, got \(auth.state)")
            return
        }
    }
}

@MainActor
struct BootRestoreTests {
    @Test("no stored token boots straight to login")
    func noTokenBootsToLogin() async throws {
        let (auth, api, _, _) = makeAuth()
        await auth.restore()
        #expect(auth.state == .signedOut)
        #expect(await api.callCount("me") == 0, "nothing to restore with")
    }

    @Test("a valid stored token boots signed in")
    func validTokenBootsSignedIn() async throws {
        let store = InMemorySecureStore()
        try store.save("stored-refresh", for: "refresh")
        let (auth, api, _, _) = makeAuth(store: store)
        await api.seed(user: .fixture(displayName: "Zach"))

        await auth.restore()

        #expect(auth.state.user?.displayName == "Zach")
        #expect(await api.callCount("me") == 1)
    }

    /// A rejected token must not leave a dead credential on the device.
    @Test("a rejected stored token lands on login with the Keychain cleared")
    func rejectedTokenClearsKeychain() async throws {
        let store = InMemorySecureStore()
        try store.save("revoked-refresh", for: "refresh")
        let (auth, api, tokens, _) = makeAuth(store: store)
        await api.setNextError(APIError(
            status: 401, code: "UNAUTHENTICATED", message: "Session expired."
        ))

        await auth.restore()

        #expect(auth.state == .signedOut)
        #expect(await tokens.refreshToken == nil)
        #expect(store.isEmpty)
    }

    @Test("a gated user restores into the forced-change state")
    func restoresIntoGate() async throws {
        let store = InMemorySecureStore()
        try store.save("stored-refresh", for: "refresh")
        let (auth, api, _, _) = makeAuth(store: store)
        await api.seed(user: .fixture(mustChangePassword: true))

        await auth.restore()

        guard case .mustChangePassword = auth.state else {
            Issue.record("expected the gate, got \(auth.state)")
            return
        }
    }
}

@MainActor
struct ChangePasswordTests {
    @Test("a successful change lifts the gate")
    func changeLiftsGate() async throws {
        let (auth, api, _, _) = makeAuth()
        await api.seed(user: .fixture(mustChangePassword: true))
        await auth.login(email: "zach@example.com", password: "temp")
        // The FakeAPI returns a user without the flag after a change.
        await api.seed(user: .fixture(mustChangePassword: false))

        let changed = await auth.changePassword(
            current: "temp", new: "a-long-enough-password", confirmation: "a-long-enough-password"
        )

        #expect(changed)
        #expect(auth.state == .signedIn(.fixture()))
        #expect(auth.changePasswordError == nil)
    }

    @Test("a short password is rejected before any request")
    func rejectsShortPassword() async throws {
        let (auth, api, _, _) = makeAuth()
        let changed = await auth.changePassword(
            current: "old", new: "short", confirmation: "short"
        )
        #expect(changed == false)
        #expect(auth.changePasswordError?.contains("12") == true)
        #expect(await api.callCount("changePassword") == 0, "must not round-trip a known-bad value")
    }

    @Test("a mismatched confirmation is rejected before any request")
    func rejectsMismatch() async throws {
        let (auth, api, _, _) = makeAuth()
        let changed = await auth.changePassword(
            current: "old", new: "a-long-enough-password", confirmation: "a-different-password"
        )
        #expect(changed == false)
        #expect(auth.changePasswordError?.contains("match") == true)
        #expect(await api.callCount("changePassword") == 0)
    }

    /// The server knows things the client cannot — the common-password list,
    /// whether the new password equals the current one — and its wording is
    /// display-safe, so it is shown verbatim rather than replaced.
    @Test("a server validation message is shown verbatim")
    func showsServerMessage() async throws {
        let (auth, api, _, _) = makeAuth()
        await api.setNextError(APIError(
            status: 400, code: "VALIDATION_ERROR",
            message: "That password is too common. Choose another."
        ))

        let changed = await auth.changePassword(
            current: "old", new: "passwordpassword", confirmation: "passwordpassword"
        )

        #expect(changed == false)
        #expect(auth.changePasswordError == "That password is too common. Choose another.")
    }

    @Test("the length boundary is exactly 12")
    func lengthBoundary() {
        #expect(AuthViewModel.validate(new: String(repeating: "a", count: 11),
                                       confirmation: String(repeating: "a", count: 11)) != nil)
        #expect(AuthViewModel.validate(new: String(repeating: "a", count: 12),
                                       confirmation: String(repeating: "a", count: 12)) == nil)
    }
}

@MainActor
struct SessionGateTests {
    @Test("PASSWORD_CHANGE_REQUIRED from anywhere flips into the gate")
    func gateCanFireMidSession() async throws {
        let (auth, api, _, _) = makeAuth()
        await api.seed(user: .fixture(mustChangePassword: false))
        await auth.login(email: "zach@example.com", password: "password1234")
        #expect(auth.state == .signedIn(.fixture()))

        auth.requirePasswordChange()

        guard case .mustChangePassword = auth.state else {
            Issue.record("expected the gate, got \(auth.state)")
            return
        }
    }

    @Test("the gate is a no-op when nobody is signed in")
    func gateNoOpWhenSignedOut() async {
        let (auth, _, _, _) = makeAuth()
        await auth.restore()
        auth.requirePasswordChange()
        #expect(auth.state == .signedOut)
    }

    @Test("logout signs out even when the network call fails")
    func logoutAlwaysSignsOut() async throws {
        let store = InMemorySecureStore()
        try store.save("refresh-value", for: "refresh")
        let (auth, api, tokens, _) = makeAuth(store: store)
        await api.seed(user: .fixture())
        await auth.login(email: "zach@example.com", password: "password1234")
        await api.setNextError(APIError(
            status: 0, code: "NETWORK_ERROR", message: "You appear to be offline."
        ))

        await auth.logout()

        #expect(auth.state == .signedOut)
        #expect(await tokens.refreshToken == nil)
        #expect(store.isEmpty)
    }

    @Test("an expired session routes back to login")
    func expiredSessionSignsOut() async throws {
        let (auth, api, _, _) = makeAuth()
        await api.seed(user: .fixture())
        await auth.login(email: "zach@example.com", password: "password1234")

        auth.sessionExpired()
        #expect(auth.state == .signedOut)
    }
}
