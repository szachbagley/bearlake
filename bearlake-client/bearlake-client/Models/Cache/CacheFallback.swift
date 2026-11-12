//
//  CacheFallback.swift
//  bearlake-client
//
// Cached content is available only for an explicitly eligible connection failure.
// The server remains authoritative about access and resource existence.

import Foundation

@MainActor
enum CacheFallback {
    enum Outcome<Value> {
        /// Show this, read-only, with the banner.
        case cached(Value)
        /// Show this message. There was nothing cached.
        case failed(String)
    }

    /// For list endpoints. An empty cache is a miss, not an empty result:
    /// rendering `[]` would tell the family there are no events when the
    /// truth is that we could not ask.
    static func forList<C: Collection>(
        _ error: Error, cached: C, fallback: String
    ) -> Outcome<C> {
        isEligible(error) && !cached.isEmpty ? .cached(cached) : .failed(message(error, fallback))
    }

    /// For single-item endpoints, where absence is unambiguous.
    static func forItem<Value>(
        _ error: Error, cached: Value?, fallback: String
    ) -> Outcome<Value> {
        if isEligible(error), let cached { return .cached(cached) }
        return .failed(message(error, fallback))
    }

    static func isEligible(_ error: Error) -> Bool {
        if let error = error as? APIError {
            return error.status == 0 && error.is(.network)
        }
        guard let error = error as? URLError else { return false }
        switch error.code {
        case .notConnectedToInternet, .networkConnectionLost, .timedOut,
             .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed,
             .internationalRoamingOff, .dataNotAllowed:
            return true
        default:
            return false
        }
    }

    static func invalidatesContent(_ error: Error) -> Bool {
        guard let error = error as? APIError else { return false }
        return [401, 403, 404].contains(error.status)
            || error.is(.passwordChangeRequired) || error.is(.accountDisabled)
    }

    /// The server's message when there is one — it is written to be shown
    /// (§API conventions) — and a plain sentence when the failure never
    /// reached the server.
    static func message(_ error: Error, _ fallback: String) -> String {
        (error as? APIError)?.message ?? fallback
    }
}
