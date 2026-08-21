//
//  YouTube.swift
//  bearlake-client
//
//  Ported from bearlake-web/src/utils/youtube.ts. Both clients must accept
//  the same set of pasted URLs, or an admin who can add a video on one
//  surface hits an unexplained rejection on the other.
//

import Foundation

enum YouTube {
    /// The four URL shapes, plus a bare id. Only the 11-character id is ever
    /// stored — not a full URL and not an embed snippet (C37).
    private static let urlPatterns: [String] = [
        #"(?:^|//)(?:www\.)?youtube\.com/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})"#,
        #"(?:^|//)(?:www\.)?youtu\.be/([A-Za-z0-9_-]{11})"#,
        #"(?:^|//)(?:www\.)?youtube\.com/embed/([A-Za-z0-9_-]{11})"#,
        #"(?:^|//)(?:www\.)?youtube\.com/shorts/([A-Za-z0-9_-]{11})"#,
    ]

    /// Returns the 11-character video id, or nil when the input is neither a
    /// recognized YouTube URL nor a bare valid id.
    static func extractID(from input: String) -> String? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { return nil }

        if isValidID(trimmed) { return trimmed }

        for pattern in urlPatterns {
            if let id = firstCaptureGroup(of: pattern, in: trimmed) {
                return id
            }
        }
        return nil
    }

    /// Whether a string is already a bare video id.
    static func isValidID(_ value: String) -> Bool {
        value.range(of: Limits.youTubeIDPattern, options: .regularExpression) != nil
    }

    /// The privacy-preserving embed URL for the article renderer. Built here
    /// so the id-to-URL mapping has exactly one definition.
    static func embedURL(forID id: String) -> URL? {
        guard isValidID(id) else { return nil }
        return URL(string: "https://www.youtube-nocookie.com/embed/\(id)")
    }

    private static func firstCaptureGroup(of pattern: String, in input: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(input.startIndex..., in: input)
        guard let match = regex.firstMatch(in: input, range: range),
              match.numberOfRanges > 1,
              let captured = Range(match.range(at: 1), in: input)
        else { return nil }
        return String(input[captured])
    }
}
