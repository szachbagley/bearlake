//
//  Limits.swift
//  bearlake-client
//
//  Every shared validation limit and pattern, mirrored from
//  bearlake-web/src/types/limits.ts — which is itself mirrored from the
//  server's zod schemas and guarded by that app's test/drift.test.ts.
//
//  This file follows the web app, which follows the server. Never the other
//  way around. Do not hand-edit a value here without changing the server
//  first.
//
//  Drift caveat: the web app's drift test reads the server's source at test
//  time and fails loudly when a cap changes. iOS tests run in a simulator
//  with no access to the repo, so there is no equivalent automatic check
//  here. The web drift test is the canary for both clients — these constants
//  and that file cover the same values, so a server change that breaks one
//  breaks the other. When the web drift test fails, update this file too.
//

import Foundation

enum Limits {
    // MARK: - Categories and articles

    static let categoryTitleMin = 1
    static let categoryTitleMax = 100

    static let articleTitleMin = 1
    static let articleTitleMax = 200

    static let maxBlocksPerArticle = 200

    // MARK: - Blocks

    static let headingTextMin = 1
    static let headingTextMax = 200

    static let paragraphTextMin = 1
    static let paragraphTextMax = 10_000

    static let bulletItemsMin = 1
    static let bulletItemsMax = 100
    static let bulletItemTextMin = 1
    static let bulletItemTextMax = 500

    static let blockCaptionMax = 300

    /// `articles/{articleId}/{uuid}` — the upload namespace.
    static let imageKeyPattern = "^articles/[0-9a-f-]{36}/[0-9a-f-]{36}$"
    /// A YouTube video id is exactly 11 URL-safe base64 characters.
    static let youTubeIDPattern = "^[A-Za-z0-9_-]{11}$"

    // MARK: - Uploads

    /// The server's content-type allowlist. iOS re-encodes everything to JPEG
    /// before upload (C41), so in practice only the first is ever sent — the
    /// others are here because the list is part of the contract.
    static let allowedUploadContentTypes = ["image/jpeg", "image/png", "image/heic"]

    /// 10 MB. The server applies this to `contentLength`, so the client must
    /// apply it to the **post-downscale** bytes too — checking the original
    /// would reject photos that upload fine at a few hundred KB.
    static let maxUploadBytes = 10 * 1024 * 1024

    /// A far looser ceiling on what we will hand to the image decoder, so a
    /// pathological input cannot exhaust memory before it is downscaled.
    /// Not the upload limit — that is `maxUploadBytes`, applied after.
    static let maxDecodeBytes = 100 * 1024 * 1024

    // MARK: - Events

    static let eventTitleMin = 1
    static let eventTitleMax = 200
    static let eventNotesMax = 5_000

    /// The range query window cap. `GET /events` requires start and end and
    /// refuses a window wider than this, so the calendar fetches the visible
    /// month plus a buffer rather than the whole table.
    static let eventRangeMaxWindowDays = 366

    // MARK: - Announcements

    static let announcementBodyMin = 1
    static let announcementBodyMax = 5_000

    static let announcementListLimitMin = 1
    static let announcementListLimitMax = 50
    static let announcementListLimitDefault = 20

    // MARK: - Quick tips

    static let quickTipBodyMin = 1
    static let quickTipBodyMax = 1_000

    // MARK: - Users

    static let userDisplayNameMin = 1
    static let userDisplayNameMax = 100

    /// Passwords: minimum 12 characters, no composition rules, checked
    /// against a common-password list server-side.
    static let passwordMin = 12
}
