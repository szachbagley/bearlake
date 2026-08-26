//
//  CacheFallback.swift
//  bearlake-client
//
//  Phase 10, step 3. The C46 decision, written once.
//
//  When a fetch fails there are exactly two outcomes, and which one applies
//  depends only on whether the cache has anything to show:
//
//    - something cached  → render it read-only behind an offline banner
//    - nothing cached    → surface an actionable error (never an empty list,
//                          which reads as "there is nothing here")
//
//  Six ViewModels make this call. Restating it in each is how the halves
//  drift apart — one of them ends up showing a blank screen instead of an
//  error, and nobody notices until the network is actually down.
//

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
        cached.isEmpty ? .failed(message(error, fallback)) : .cached(cached)
    }

    /// For single-item endpoints, where absence is unambiguous.
    static func forItem<Value>(
        _ error: Error, cached: Value?, fallback: String
    ) -> Outcome<Value> {
        if let cached { return .cached(cached) }
        return .failed(message(error, fallback))
    }

    /// The server's message when there is one — it is written to be shown
    /// (§API conventions) — and a plain sentence when the failure never
    /// reached the server.
    static func message(_ error: Error, _ fallback: String) -> String {
        (error as? APIError)?.message ?? fallback
    }
}
