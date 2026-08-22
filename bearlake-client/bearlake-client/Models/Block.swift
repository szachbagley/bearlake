//
//  Block.swift
//  bearlake-client
//
//  The Swift half of the block schema contract (spec §4.2, C30/C31).
//  Mirrors bearlake-web/src/types/blocks.ts. Changing the schema is a
//  three-app task — server validation, React editor, and both iOS surfaces
//  move together.
//

import Foundation

/// A block whose `type` this build does not recognize.
///
/// Only reachable after a *future* schema addition — the server rejects
/// unknown types today. That is precisely when dropping the content would be
/// unrecoverable, because a family device may run this build for months after
/// a new block type ships from the web app.
struct UnknownBlock: Equatable, Sendable {
    let id: String
    let type: String
    /// The complete original object, `id` and `type` included, so re-encoding
    /// reproduces every field this build knew nothing about.
    let raw: [String: JSONValue]
}

enum Block: Equatable, Sendable, Identifiable {
    case heading(id: String, text: String)
    case paragraph(id: String, text: String)
    case bullets(id: String, items: [String])
    /// `url` is the transient presigned URL the API attaches at read time.
    /// It is decoded for rendering and **never encoded** (C34) — see the
    /// note on `encode(to:)`.
    case image(id: String, key: String, caption: String?, url: String?)
    case video(id: String, videoId: String, caption: String?)
    case unknown(UnknownBlock)

    var id: String {
        switch self {
        case .heading(let id, _): return id
        case .paragraph(let id, _): return id
        case .bullets(let id, _): return id
        case .image(let id, _, _, _): return id
        case .video(let id, _, _): return id
        case .unknown(let block): return block.id
        }
    }

    /// The wire `type`, including for blocks this build cannot render.
    var typeName: String {
        switch self {
        case .heading: return "heading"
        case .paragraph: return "paragraph"
        case .bullets: return "bullets"
        case .image: return "image"
        case .video: return "video"
        case .unknown(let block): return block.type
        }
    }

    var isUnknown: Bool {
        if case .unknown = self { return true }
        return false
    }

    /// C33. Every new block gets a fresh lowercase UUID; ids are the identity
    /// for reordering, editing, and `List` diffing, and the server validates
    /// the format.
    static func newID() -> String {
        UUID().uuidString.lowercased()
    }
}

extension Block: Codable {
    private enum CodingKeys: String, CodingKey {
        case id, type, text, items, key, caption, provider, videoId, url
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        let id = try container.decode(String.self, forKey: .id)

        // A recognized type must satisfy its own shape. Falling back to
        // `.unknown` on a malformed *known* block would quietly turn a broken
        // heading into an opaque blob that the editor then round-trips
        // forever, so decode errors are allowed to propagate here.
        switch type {
        case "heading":
            self = .heading(id: id, text: try container.decode(String.self, forKey: .text))
        case "paragraph":
            self = .paragraph(id: id, text: try container.decode(String.self, forKey: .text))
        case "bullets":
            self = .bullets(id: id, items: try container.decode([String].self, forKey: .items))
        case "image":
            self = .image(
                id: id,
                key: try container.decode(String.self, forKey: .key),
                caption: try container.decodeIfPresent(String.self, forKey: .caption),
                url: try container.decodeIfPresent(String.self, forKey: .url)
            )
        case "video":
            // `provider` is 'youtube' and nothing else, but it is validated
            // rather than ignored: a block claiming another provider is not
            // something this renderer can honour.
            let provider = try container.decode(String.self, forKey: .provider)
            guard provider == "youtube" else {
                throw DecodingError.dataCorruptedError(
                    forKey: .provider,
                    in: container,
                    debugDescription: "Unsupported video provider: \(provider)"
                )
            }
            self = .video(
                id: id,
                videoId: try container.decode(String.self, forKey: .videoId),
                caption: try container.decodeIfPresent(String.self, forKey: .caption)
            )
        default:
            let raw = try decoder.singleValueContainer().decode([String: JSONValue].self)
            self = .unknown(UnknownBlock(id: id, type: type, raw: raw))
        }
    }

    /// Writes the persisted shape.
    ///
    /// The image case deliberately has **no `url` branch**. The presigned URL
    /// rotates on every read and expires in 15 minutes, so persisting it
    /// would bake in an expiry and a bucket name (C34). The web app strips it
    /// with a helper that a caller has to remember to invoke; here it is
    /// simply unrepresentable on the way out, which is the same guarantee
    /// without the discipline.
    func encode(to encoder: Encoder) throws {
        // An unknown block re-emits its original object verbatim rather than
        // going through the keyed container, so fields this build never knew
        // about survive (C31).
        if case .unknown(let block) = self {
            var container = encoder.singleValueContainer()
            try container.encode(block.raw)
            return
        }

        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(typeName, forKey: .type)

        switch self {
        case .heading(_, let text), .paragraph(_, let text):
            try container.encode(text, forKey: .text)
        case .bullets(_, let items):
            try container.encode(items, forKey: .items)
        case .image(_, let key, let caption, _):
            try container.encode(key, forKey: .key)
            try container.encodeIfPresent(caption, forKey: .caption)
        case .video(_, let videoId, let caption):
            try container.encode("youtube", forKey: .provider)
            try container.encode(videoId, forKey: .videoId)
            try container.encodeIfPresent(caption, forKey: .caption)
        case .unknown:
            break  // handled above
        }
    }
}
