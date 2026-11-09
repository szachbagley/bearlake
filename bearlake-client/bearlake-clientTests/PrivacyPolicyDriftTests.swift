//
//  PrivacyPolicyDriftTests.swift
//  bearlake-clientTests
//
//  C56. The policy exists twice: `docs/privacy-policy.md`, which gets hosted
//  at the URL App Store Connect requires, and `PrivacyPolicyView`, which is
//  what a family member actually reads.
//
//  Two copies of a legal document is the kind of duplication that silently
//  rots — someone updates the hosted one, the app keeps showing last year's.
//  A comment saying "keep these in sync" is not enforcement. This is.
//

import Foundation
import Testing
@testable import bearlake_client

struct PrivacyPolicyDriftTests {
    /// The repo root, derived from this file's compile-time path rather than
    /// a bundle resource — the markdown is a repo document, not something the
    /// app ships.
    private static var repoRoot: URL {
        URL(fileURLWithPath: #filePath)          // …/bearlake-clientTests/this.swift
            .deletingLastPathComponent()          // …/bearlake-clientTests
            .deletingLastPathComponent()          // …/bearlake-client
            .deletingLastPathComponent()          // …/bearlake
    }

    private static var policyMarkdown: String? {
        try? String(
            contentsOf: repoRoot.appending(path: "docs/privacy-policy.md"),
            encoding: .utf8
        )
    }

    /// Bumping the date in one copy and not the other is exactly how these
    /// drift, so the date is the thing pinned.
    @Test("the in-app policy and the hosted document share a Last updated date")
    func datesMatch() throws {
        let markdown = try #require(
            Self.policyMarkdown,
            "docs/privacy-policy.md not found — has it moved?"
        )

        // "**Last updated:** 2026-08-28"
        let marker = "**Last updated:**"
        let line = try #require(
            markdown.split(separator: "\n").first { $0.contains(marker) },
            "docs/privacy-policy.md has no 'Last updated:' line"
        )
        let documentDate = line
            .replacingOccurrences(of: marker, with: "")
            .replacingOccurrences(of: "*", with: "")
            .trimmingCharacters(in: .whitespaces)

        #expect(
            documentDate == PrivacyPolicyView.lastUpdated,
            """
            The privacy policy changed in one place but not the other.
            docs/privacy-policy.md says \(documentDate); \
            PrivacyPolicyView.lastUpdated says \(PrivacyPolicyView.lastUpdated). \
            Update both, then bump both dates.
            """
        )
    }

    /// A weaker but useful check: the substantive claims a reader relies on
    /// should appear in both. These are the ones that would matter if the app
    /// quietly started doing something else.
    @Test("both copies make the same load-bearing claims", arguments: [
        "youtube-nocookie",     // the one third party a device contacts
        "Keychain",             // where the token lives
        "passcode",             // the honest caveat about encryption at rest
        "deactivated",          // accounts are not deleted
    ])
    func bothMentionKeyClaims(term: String) throws {
        let markdown = try #require(Self.policyMarkdown)
        #expect(
            markdown.localizedCaseInsensitiveContains(term),
            "docs/privacy-policy.md no longer mentions '\(term)'"
        )
    }
}
