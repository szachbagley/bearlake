//
//  APIError.swift
//  bearlake-client
//

import Foundation

/// Every error code the server can return.
///
/// Deliberately **not** the type of `APIError.code` (C17): an unrecognized
/// code — one the server starts sending before this build is replaced —
/// must still carry the server's real message rather than collapsing into a
/// generic failure. This enum exists for comparison at the handful of call
/// sites that treat a specific code specially.
enum KnownErrorCode: String, Sendable {
    case validationError = "VALIDATION_ERROR"
    case invalidCredentials = "INVALID_CREDENTIALS"
    case unauthenticated = "UNAUTHENTICATED"
    case forbidden = "FORBIDDEN"
    case passwordChangeRequired = "PASSWORD_CHANGE_REQUIRED"
    case accountDisabled = "ACCOUNT_DISABLED"
    case notFound = "NOT_FOUND"
    case staleArticle = "STALE_ARTICLE"
    case categoryNotEmpty = "CATEGORY_NOT_EMPTY"
    case emailInUse = "EMAIL_IN_USE"
    case rateLimited = "RATE_LIMITED"
    case payloadTooLarge = "PAYLOAD_TOO_LARGE"
    case internalError = "INTERNAL"

    /// Synthesized by the client, never sent by the server: the request never
    /// reached a response at all.
    case network = "NETWORK_ERROR"
}

/// A failed API call.
///
/// `message` is display-safe — the server is written to keep SQL and stack
/// traces out of it — so views show it to the user directly rather than
/// substituting a vaguer string of our own.
struct APIError: Error, Equatable, Sendable {
    /// The HTTP status, or 0 when the request never got one.
    let status: Int
    let code: String
    let message: String

    var known: KnownErrorCode? { KnownErrorCode(rawValue: code) }

    func `is`(_ candidate: KnownErrorCode) -> Bool { code == candidate.rawValue }

    /// The request never reached the server — offline, DNS, TLS, a dropped
    /// connection. Distinguished from a timeout, which is worth a different
    /// sentence: "try again" is unhelpful advice when the request may still
    /// be in flight.
    static func offline(_ underlying: URLError) -> APIError {
        let message: String
        switch underlying.code {
        case .timedOut:
            message = "The server took too long to respond. Please try again."
        case .notConnectedToInternet, .networkConnectionLost:
            message = "You appear to be offline. Check your connection and try again."
        default:
            message = "Can't reach Bear Lake. Check your connection and try again."
        }
        return APIError(status: 0, code: KnownErrorCode.network.rawValue, message: message)
    }

    /// A response that carried no usable `{error:{code,message}}` body.
    ///
    /// A 500 from a crashed process or a proxy often arrives as HTML, and a
    /// decode failure there would surface as "the data couldn't be read",
    /// which tells the user nothing. Mapping to the status-appropriate code
    /// keeps the failure honest and the message actionable.
    static func unparsable(status: Int) -> APIError {
        APIError(
            status: status,
            code: KnownErrorCode.internalError.rawValue,
            message: "Something went wrong on the server. Please try again."
        )
    }
}

extension APIError: LocalizedError {
    var errorDescription: String? { message }
}

/// The wire shape: `{ "error": { "code": ..., "message": ... } }`.
struct APIErrorEnvelope: Decodable {
    struct Payload: Decodable {
        let code: String
        let message: String
    }
    let error: Payload
}
