//
//  AuthViewModel.swift
//  bearlake-client
//
//  Deliberately imports Observation rather than SwiftUI: ViewModels must not
//  depend on the view layer (CLAUDE.md).
//

import Foundation
import Observation

/// Where the app is, session-wise. The root view switches on this and
/// nothing else, so there is exactly one place that decides what the user
/// sees.
enum SessionState: Equatable, Sendable {
    /// Before first paint, while a stored refresh token is being redeemed.
    case restoring
    case signedOut
    /// Signed in but gated: `mustChangePassword` is set, so the server
    /// refuses every route except change-password and `/me`. No tab bar.
    case mustChangePassword(PublicUser)
    case signedIn(PublicUser)

    var user: PublicUser? {
        switch self {
        case .mustChangePassword(let user), .signedIn(let user): return user
        case .restoring, .signedOut: return nil
        }
    }
}

@MainActor
@Observable
final class AuthViewModel {
    private(set) var state: SessionState = .restoring
    private(set) var isWorking = false

    /// Shown beneath the login form. Nil when there is nothing to say.
    private(set) var loginError: String?
    /// Shown on the change-password form.
    private(set) var changePasswordError: String?

    private let api: BearLakeAPI
    private let tokens: TokenStore

    init(api: BearLakeAPI, tokens: TokenStore) {
        self.api = api
        self.tokens = tokens
    }

    var currentUser: PublicUser? { state.user }
    var isAdmin: Bool { state.user?.isAdmin ?? false }

    // MARK: - Boot

    /// Redeems a stored refresh token before first paint.
    ///
    /// Deliberately just calls `/me`. The access token lives in memory only,
    /// so at launch there is never one — the call 401s, which drives the
    /// client's single-flight refresh (C18), and the retry succeeds. Reusing
    /// that path rather than refreshing explicitly means boot restore is
    /// covered by the same tested machinery as every other expired token,
    /// including the theft-detection behaviour on a revoked family.
    func restore() async {
        guard await tokens.hasSession else {
            state = .signedOut
            return
        }
        do {
            let user = try await api.me()
            state = gatedState(for: user)
        } catch {
            // The stored token is dead. `APIClient` has already cleared the
            // Keychain via its refresh failure path; clearing again is
            // harmless and covers a non-401 failure.
            await tokens.clear()
            state = .signedOut
        }
    }

    // MARK: - Login

    func login(email: String, password: String) async {
        guard isWorking == false else { return }
        loginError = nil
        isWorking = true
        defer { isWorking = false }

        do {
            let session = try await api.login(
                email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                password: password
            )
            state = gatedState(for: session.user)
        } catch let error as APIError {
            loginError = loginMessage(for: error)
        } catch {
            loginError = Self.genericLoginFailure
        }
    }

    /// One message for every failure except rate limiting.
    ///
    /// Distinguishing "no such account" from "wrong password" would let
    /// anyone enumerate which family members have accounts. Rate limiting is
    /// the exception because "try again in a minute" is information the user
    /// needs in order to act, and it reveals nothing about the account.
    private func loginMessage(for error: APIError) -> String {
        if error.is(.rateLimited) { return error.message }
        if error.is(.network) { return error.message }
        return Self.genericLoginFailure
    }

    static let genericLoginFailure =
        "That email and password don't match. Please try again."

    // MARK: - Change password

    /// - Returns: true when the password changed.
    @discardableResult
    func changePassword(current: String, new: String, confirmation: String) async -> Bool {
        guard isWorking == false else { return false }
        changePasswordError = nil

        if let complaint = Self.validate(new: new, confirmation: confirmation) {
            changePasswordError = complaint
            return false
        }

        isWorking = true
        defer { isWorking = false }

        do {
            let session = try await api.changePassword(
                currentPassword: current, newPassword: new
            )
            // The server revokes every other refresh token on a change, so
            // the pair in this response is the only live credential — and
            // mustChangePassword is now false, which lifts the gate.
            state = gatedState(for: session.user)
            return true
        } catch let error as APIError {
            // Server validation messages are display-safe and more specific
            // than anything invented here ("that password is too common"),
            // so they are shown verbatim.
            changePasswordError = error.message
            return false
        } catch {
            changePasswordError = "Couldn't change your password. Please try again."
            return false
        }
    }

    /// Client-side checks that spare a round trip. The server enforces these
    /// too, plus a common-password list this app has no copy of.
    static func validate(new: String, confirmation: String) -> String? {
        if new.count < Limits.passwordMin {
            return "Your new password must be at least \(Limits.passwordMin) characters."
        }
        if new != confirmation {
            return "The two new passwords don't match."
        }
        return nil
    }

    // MARK: - Logout

    /// Always ends signed out. `APIClient.logout` revokes best-effort and
    /// clears locally regardless of whether the network call worked (C21) —
    /// a failed sign-out that leaves the user apparently signed in is worse
    /// than the error it would report.
    func logout() async {
        try? await api.logout()
        await tokens.clear()
        state = .signedOut
    }

    // MARK: - Gate

    /// Called by the client when any route answers `PASSWORD_CHANGE_REQUIRED`
    /// — the gate can fire from anywhere, not only at login (C4 step 4).
    func requirePasswordChange() {
        guard let user = state.user else { return }
        state = .mustChangePassword(user)
    }

    /// Called when a refresh fails and the session cannot be recovered.
    func sessionExpired() {
        state = .signedOut
    }

    private func gatedState(for user: PublicUser) -> SessionState {
        user.mustChangePassword ? .mustChangePassword(user) : .signedIn(user)
    }
}
