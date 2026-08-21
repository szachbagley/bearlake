//
//  YouTubeTests.swift
//  bearlake-clientTests
//

import Foundation
import Testing
@testable import bearlake_client

struct YouTubeTests {
    private let id = "dQw4w9WgXcQ"

    @Test("all four URL shapes yield the id", arguments: [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ",
        "https://www.youtu.be/dQw4w9WgXcQ",
        "https://www.youtube.com/embed/dQw4w9WgXcQ",
        "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    ])
    func extractsFromURL(url: String) {
        #expect(YouTube.extractID(from: url) == "dQw4w9WgXcQ")
    }

    @Test("a watch URL with extra query parameters still yields the id")
    func extractsWithExtraParams() {
        #expect(
            YouTube.extractID(from: "https://www.youtube.com/watch?list=PLabc&v=dQw4w9WgXcQ&t=42")
                == id
        )
    }

    @Test("a bare id passes through")
    func acceptsBareID() {
        #expect(YouTube.extractID(from: id) == id)
        #expect(YouTube.extractID(from: "  \(id)  ") == id)
    }

    @Test("ids using the full URL-safe alphabet are accepted")
    func acceptsURLSafeAlphabet() {
        #expect(YouTube.extractID(from: "_-Ab0123456") == "_-Ab0123456")
    }

    @Test("junk is rejected", arguments: [
        "",
        "   ",
        "not a url",
        "https://vimeo.com/123456789",
        "https://www.youtube.com/watch?v=tooshort",
        "https://www.youtube.com/watch",
        "dQw4w9WgXc",       // 10 characters
        "dQw4w9WgXcQQ",     // 12 characters
        "dQw4w9WgXc!",      // invalid character
    ])
    func rejectsJunk(input: String) {
        #expect(YouTube.extractID(from: input) == nil)
    }

    @Test("id validation matches the server's pattern")
    func validatesIDs() {
        #expect(YouTube.isValidID(id))
        #expect(YouTube.isValidID("short") == false)
        #expect(YouTube.isValidID("way-too-long-to-be-valid") == false)
    }

    @Test("the embed URL is the no-cookie host")
    func buildsEmbedURL() {
        let url = YouTube.embedURL(forID: id)
        #expect(url?.absoluteString == "https://www.youtube-nocookie.com/embed/\(id)")
        #expect(YouTube.embedURL(forID: "invalid") == nil)
    }

    /// A stored block must carry the id alone — never a URL, never an embed
    /// snippet — so an id extracted from any shape re-extracts to itself.
    @Test("extraction is idempotent")
    func idempotent() {
        for input in [
            "https://youtu.be/\(id)",
            "https://www.youtube.com/embed/\(id)",
            id,
        ] {
            let once = YouTube.extractID(from: input)
            #expect(once == id)
            #expect(YouTube.extractID(from: once ?? "") == id)
        }
    }
}

struct LimitsTests {
    /// These constants are transcribed from bearlake-web/src/types/limits.ts.
    /// iOS tests cannot read that file at runtime, so this asserts the values
    /// are internally coherent rather than that they match the server — see
    /// the drift caveat at the top of Limits.swift.
    @Test("limits are coherent")
    func coherent() {
        #expect(Limits.categoryTitleMin < Limits.categoryTitleMax)
        #expect(Limits.articleTitleMin < Limits.articleTitleMax)
        #expect(Limits.headingTextMin < Limits.headingTextMax)
        #expect(Limits.paragraphTextMin < Limits.paragraphTextMax)
        #expect(Limits.bulletItemsMin < Limits.bulletItemsMax)
        #expect(Limits.announcementListLimitDefault <= Limits.announcementListLimitMax)
        #expect(Limits.announcementListLimitDefault >= Limits.announcementListLimitMin)
        #expect(Limits.maxUploadBytes == 10 * 1024 * 1024)
        #expect(Limits.passwordMin == 12)
    }

    @Test("the image key pattern matches the upload namespace")
    func imageKeyPattern() {
        let valid = "articles/9f9a1eb9-0000-4000-8000-000000000001/d532caad-0000-4000-8000-000000000002"
        #expect(valid.range(of: Limits.imageKeyPattern, options: .regularExpression) != nil)
        #expect("articles/nope/also-nope".range(
            of: Limits.imageKeyPattern, options: .regularExpression) == nil)
    }

    @Test("iOS uploads JPEG, which is on the allowlist")
    func jpegAllowed() {
        #expect(Limits.allowedUploadContentTypes.contains("image/jpeg"))
    }
}
