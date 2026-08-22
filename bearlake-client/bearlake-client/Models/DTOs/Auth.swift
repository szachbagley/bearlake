//
//  Auth.swift
//  bearlake-client
//

import Foundation

struct LoginRequest: Encodable, Sendable {
    let email: String
    let password: String
}

struct RefreshRequest: Encodable, Sendable {
    let refreshToken: String
}

struct LogoutRequest: Encodable, Sendable {
    let refreshToken: String
}

struct ChangePasswordRequest: Encodable, Sendable {
    let currentPassword: String
    let newPassword: String
}

/// Returned by login, refresh, and change-password. The refresh token rotates
/// on every use, so the one in this response replaces whatever is in the
/// Keychain (C18/C20).
struct SessionResult: Decodable, Sendable, Equatable {
    let accessToken: String
    let refreshToken: String
    let user: PublicUser
}
