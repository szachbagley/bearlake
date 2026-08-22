//
//  BlockTests.swift
//  bearlake-clientTests
//

import Foundation
import Testing
@testable import bearlake_client

private let decoder = APICoding.makeDecoder()
private let encoder = APICoding.makeEncoder()

/// Parses JSON into a comparable structure. Round-trip assertions compare
/// these, never raw strings — Swift and TypeScript order keys differently and
/// a byte comparison fails cosmetically (C32).
private func parsed(_ data: Data) throws -> JSONValue {
    try decoder.decode(JSONValue.self, from: data)
}

private func reencode(_ block: Block) throws -> JSONValue {
    try parsed(try encoder.encode(block))
}

struct BlockDecodingTests {
    @Test("heading decodes and round-trips")
    func heading() throws {
        let json = Data(#"{"id":"a1","type":"heading","text":"Boat dock"}"#.utf8)
        let block = try decoder.decode(Block.self, from: json)
        #expect(block == .heading(id: "a1", text: "Boat dock"))
        #expect(try reencode(block) == (try parsed(json)))
    }

    @Test("paragraph decodes and round-trips")
    func paragraph() throws {
        let json = Data(#"{"id":"a2","type":"paragraph","text":"Turn the valve."}"#.utf8)
        let block = try decoder.decode(Block.self, from: json)
        #expect(block == .paragraph(id: "a2", text: "Turn the valve."))
        #expect(try reencode(block) == (try parsed(json)))
    }

    @Test("bullets decodes and round-trips")
    func bullets() throws {
        let json = Data(#"{"id":"a3","type":"bullets","items":["One","Two"]}"#.utf8)
        let block = try decoder.decode(Block.self, from: json)
        #expect(block == .bullets(id: "a3", items: ["One", "Two"]))
        #expect(try reencode(block) == (try parsed(json)))
    }

    @Test("video decodes and round-trips, re-emitting provider")
    func video() throws {
        let json = Data("""
        {"id":"a4","type":"video","provider":"youtube","videoId":"dQw4w9WgXcQ","caption":"How-to"}
        """.utf8)
        let block = try decoder.decode(Block.self, from: json)
        #expect(block == .video(id: "a4", videoId: "dQw4w9WgXcQ", caption: "How-to"))
        #expect(try reencode(block) == (try parsed(json)))
    }

    @Test("a video from another provider is rejected, not silently rendered")
    func rejectsForeignProvider() {
        let json = Data(#"{"id":"a5","type":"video","provider":"vimeo","videoId":"12345678901"}"#.utf8)
        #expect(throws: DecodingError.self) {
            _ = try decoder.decode(Block.self, from: json)
        }
    }

    @Test("an absent caption stays absent rather than becoming null")
    func omitsAbsentCaption() throws {
        let json = Data(#"{"id":"a6","type":"video","provider":"youtube","videoId":"dQw4w9WgXcQ"}"#.utf8)
        let block = try decoder.decode(Block.self, from: json)
        let fields = try JSONSerialization.jsonObject(with: try encoder.encode(block)) as? [String: Any]
        #expect(fields?["caption"] == nil)
        #expect(fields?.keys.contains("caption") == false)
    }
}

/// C34 — the stored value is the S3 key. The presigned URL rotates on every
/// read and expires in 15 minutes, so persisting it would bake in an expiry
/// and a bucket name.
struct ImageBlockURLTests {
    private let apiJSON = Data("""
    {
      "id": "b1", "type": "image",
      "key": "articles/9f9a1eb9-0000-4000-8000-000000000001/d532caad-0000-4000-8000-000000000002",
      "caption": "The dock",
      "url": "https://bucket.s3.amazonaws.com/signed?X-Amz-Expires=900"
    }
    """.utf8)

    @Test("the presigned url decodes for rendering")
    func decodesURL() throws {
        let block = try decoder.decode(Block.self, from: apiJSON)
        guard case .image(_, let key, let caption, let url) = block else {
            Issue.record("expected an image block")
            return
        }
        #expect(key.hasPrefix("articles/"))
        #expect(caption == "The dock")
        #expect(url?.contains("X-Amz-Expires") == true)
    }

    @Test("the presigned url is never written back")
    func neverEncodesURL() throws {
        let block = try decoder.decode(Block.self, from: apiJSON)
        let data = try encoder.encode(block)
        let fields = try #require(
            try JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        #expect(fields["url"] == nil)
        #expect(Set(fields.keys) == ["id", "type", "key", "caption"])
        // The whole-payload check, since a leaked URL anywhere is the bug.
        #expect(String(decoding: data, as: UTF8.self).contains("X-Amz") == false)
    }

    @Test("a whole article payload carries no presigned url")
    func articlePayloadHasNoURL() throws {
        let block = try decoder.decode(Block.self, from: apiJSON)
        let request = UpdateArticleRequest(updatedAt: Date(), blocks: [block])
        let data = try encoder.encode(request)
        #expect(String(decoding: data, as: UTF8.self).contains("url") == false)
    }
}

/// C31 — the case that only fires after a future schema addition, which is
/// exactly when silently dropping content would be unrecoverable.
struct UnknownBlockTests {
    private let futureJSON = Data("""
    {
      "id": "c1",
      "type": "table",
      "columns": ["Item", "Where"],
      "rows": [["Life jackets", "Boathouse"]],
      "meta": {"width": 3, "compact": true, "note": null}
    }
    """.utf8)

    @Test("an unrecognized type decodes as unknown")
    func decodesAsUnknown() throws {
        let block = try decoder.decode(Block.self, from: futureJSON)
        #expect(block.isUnknown)
        #expect(block.id == "c1")
        #expect(block.typeName == "table")
    }

    @Test("an unknown block round-trips structurally identical")
    func roundTripsUnchanged() throws {
        let block = try decoder.decode(Block.self, from: futureJSON)
        #expect(try reencode(block) == (try parsed(futureJSON)))
    }

    /// The specific loss this guards against: nested fields, a bool that must
    /// not become a number, and an explicit null that must not vanish.
    @Test("nested values survive verbatim, including false and null")
    func preservesNestedValues() throws {
        let block = try decoder.decode(Block.self, from: futureJSON)
        guard case .unknown(let unknown) = block else {
            Issue.record("expected an unknown block")
            return
        }
        guard case .object(let meta)? = unknown.raw["meta"] else {
            Issue.record("expected a nested meta object")
            return
        }
        #expect(meta["compact"] == .bool(true))
        #expect(meta["note"] == .null)
        #expect(meta["width"] == .number(3))
    }

    /// A malformed *known* block must be an error, not quietly reclassified —
    /// otherwise a broken heading becomes an opaque blob the editor
    /// round-trips forever.
    @Test("a malformed known block is rejected, not treated as unknown")
    func rejectsMalformedKnownBlock() {
        let missingText = Data(#"{"id":"d1","type":"heading"}"#.utf8)
        #expect(throws: DecodingError.self) {
            _ = try decoder.decode(Block.self, from: missingText)
        }

        let wrongItemType = Data(#"{"id":"d2","type":"bullets","items":"not an array"}"#.utf8)
        #expect(throws: DecodingError.self) {
            _ = try decoder.decode(Block.self, from: wrongItemType)
        }
    }

    @Test("a mixed article preserves the unknown block among known ones")
    func mixedArticleRoundTrips() throws {
        let json = Data("""
        [
          {"id":"e1","type":"heading","text":"Dock"},
          {"id":"e2","type":"table","cells":[[1,2]]},
          {"id":"e3","type":"paragraph","text":"Done."}
        ]
        """.utf8)
        let blocks = try decoder.decode([Block].self, from: json)
        #expect(blocks.count == 3)
        #expect(blocks.map(\.isUnknown) == [false, true, false])
        #expect(try parsed(try encoder.encode(blocks)) == (try parsed(json)))
    }
}

struct BlockIdentityTests {
    @Test("new ids are lowercase UUIDs and unique")
    func newIDs() {
        let ids = (0..<50).map { _ in Block.newID() }
        #expect(Set(ids).count == 50)
        for id in ids {
            #expect(id == id.lowercased())
            #expect(UUID(uuidString: id) != nil)
        }
    }
}

struct ArticleDecodingTests {
    @Test("a full article decodes with its blocks")
    func decodesArticle() throws {
        let json = Data("""
        {
          "id": "f1", "categoryId": "f2", "title": "Boat",
          "blocks": [{"id":"f3","type":"heading","text":"Start"}],
          "schemaVersion": 1, "status": "published", "sortOrder": 0,
          "createdBy": "u1",
          "createdAt": "2026-08-01T12:00:00.000Z",
          "updatedAt": "2026-08-02T12:00:00.000Z"
        }
        """.utf8)
        let article = try decoder.decode(InfoArticle.self, from: json)
        #expect(article.status == .published)
        #expect(article.blocks.count == 1)
        #expect(article.blocks.first?.typeName == "heading")
    }

    @Test("an update request always carries updatedAt")
    func updateCarriesLockToken() throws {
        let request = UpdateArticleRequest(updatedAt: Date(), title: "New")
        let fields = try #require(
            try JSONSerialization.jsonObject(with: try encoder.encode(request)) as? [String: Any]
        )
        #expect(fields["updatedAt"] != nil)
        #expect(Set(fields.keys) == ["updatedAt", "title"])
    }
}
