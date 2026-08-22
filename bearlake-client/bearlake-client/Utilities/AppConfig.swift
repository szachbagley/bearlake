//
//  AppConfig.swift
//  bearlake-client
//

import Foundation

/// Where the app talks to (C12).
///
/// No secrets live here — the API base URL is public information, and the
/// only credential the app ever holds is the user's own token. A
/// build-settings mechanism would be more machinery than this needs.
enum AppConfig {
    #if DEBUG
    /// The simulator shares the Mac's network stack, so `localhost` reaches a
    /// server running via `npm run dev`. A physical device does not — Phase
    /// 11's device check runs against the deployed API instead.
    ///
    /// Cleartext HTTP to localhost is permitted by the ATS exception in
    /// `Info.plist` (C13); without it this request is blocked before it
    /// leaves the app.
    static let apiBaseURL = URL(string: "http://localhost:3000/api/v1")
    #else
    static let apiBaseURL = URL(string: "https://bearlake-server-production.up.railway.app/api/v1")
    #endif
}
