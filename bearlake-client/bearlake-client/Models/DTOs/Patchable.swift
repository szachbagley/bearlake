//
//  Patchable.swift
//  bearlake-client
//

import Foundation

/// A PATCH field that distinguishes *leave it alone* from *set it to null*.
///
/// The server merges a patch with `if (patch[key] !== undefined)`, so an
/// omitted key keeps the stored value while an explicit `null` clears it
/// (`bearlake-server/src/services/eventService.ts`). Swift's `Optional` has
/// only one empty case and cannot express both, so `notes: String?` would
/// make "clear the notes" unrepresentable — the user deletes the text, and
/// the old notes silently survive.
///
/// Only needed for fields that are **nullable and optional** on the wire
/// (zod's `.nullish()`). A merely optional field is a plain `Optional`.
enum Patchable<Value: Encodable & Equatable & Sendable>: Equatable, Sendable {
    /// Omit the key. The stored value is kept.
    case unchanged
    /// Send `null`. The stored value is cleared.
    case setNull
    /// Send this value.
    case set(Value)

    /// Builds a patch from an optional the UI produced, where nil means the
    /// user cleared the field rather than declined to touch it.
    init(clearing value: Value?) {
        self = value.map(Patchable.set) ?? .setNull
    }
}

extension KeyedEncodingContainer {
    /// Encodes a `Patchable`, omitting the key entirely for `.unchanged`.
    /// Named distinctly rather than overloading `encode` so that a `Patchable`
    /// passed to the synthesized `encode(_:forKey:)` cannot compile by
    /// accident and quietly serialize the enum itself.
    mutating func encodePatch<Value>(
        _ value: Patchable<Value>,
        forKey key: Key
    ) throws {
        switch value {
        case .unchanged:
            break
        case .setNull:
            try encodeNil(forKey: key)
        case .set(let wrapped):
            try encode(wrapped, forKey: key)
        }
    }
}
