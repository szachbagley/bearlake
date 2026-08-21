//
//  User.swift
//  bearlake-client
//
//  Transcribed from bearlake-web/src/types/api.ts, which is verified against
//  the running server. Do not re-derive from the server source (C16).
//

import Foundation

enum UserRole: String, Codable, Sendable, CaseIterable {
    case admin
    case member
}

/// The client's view of a user. Carries no `passwordHash` or other
/// server-internal field.
struct PublicUser: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let displayName: String
    let email: String
    let role: UserRole
    let mustChangePassword: Bool
    let isActive: Bool
    let lastLoginAt: Date?
    let createdAt: Date
    let updatedAt: Date

    var isAdmin: Bool { role == .admin }
}

/// iOS never creates, edits, or lists users — that is the web app's job,
/// permanently (C49). The request types for those endpoints are deliberately
/// absent rather than written and left unused.
struct ListUsersResponse: Decodable, Sendable {
    let users: [PublicUser]
}
