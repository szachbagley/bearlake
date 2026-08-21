//
//  JSONValue.swift
//  bearlake-client
//

import Foundation

/// Any JSON value, decoded losslessly.
///
/// Exists so an unknown block can keep every field this build does not
/// understand and hand them back unchanged on save (C31). Dropping them
/// would silently destroy content written from the web app.
///
/// `Equatable` is the point as much as `Codable` is: round-trip tests compare
/// **parsed structures**, never raw JSON strings, because Swift and
/// TypeScript order object keys differently and a byte comparison fails for
/// purely cosmetic reasons (C32).
indirect enum JSONValue: Codable, Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        // Order matters: Bool must be tried before Double. JSONDecoder will
        // happily decode `true` as 1.0, which would turn a flag into a number
        // on the way back out.
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unrepresentable JSON value"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}

extension JSONValue {
    /// Convenience for reading a known field out of a preserved raw block.
    var stringValue: String? {
        if case .string(let value) = self { return value }
        return nil
    }
}
