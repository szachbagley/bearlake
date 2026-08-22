//
//  APICoding.swift
//  bearlake-client
//
//  Wire encoding/decoding for the API. Calendar and display logic lives in
//  Utilities/CabinDate.swift (C27); this file only turns bytes into DTOs.
//

import Foundation

/// The JSON coders every API call uses. Configured once, here, so that a
/// timestamp cannot be parsed one way in one call site and another way
/// somewhere else.
enum APICoding {
    /// C23. The server emits `2026-01-01T00:00:00.000Z`, and
    /// `ISO8601DateFormatter` **returns nil for that string** unless
    /// `.withFractionalSeconds` is set — a decode failure that surfaces as
    /// missing data rather than as an error. Both formatters exist because a
    /// formatter configured *with* fractional seconds symmetrically refuses a
    /// timestamp *without* them, and not every field is guaranteed to carry
    /// them (`lastLoginAt` is written by a different code path than
    /// `createdAt`). Trying both is the only shape that cannot silently fail.
    private static let withFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let withoutFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    /// Parses an ISO-8601 instant from the API. Returns nil rather than
    /// throwing so callers can decide whether a bad value is fatal.
    static func date(fromISO string: String) -> Date? {
        withFractional.date(from: string) ?? withoutFractional.date(from: string)
    }

    /// Formats an instant for the API. Always emits fractional seconds, which
    /// is what the server itself produces.
    static func iso(from date: Date) -> String {
        withFractional.string(from: date)
    }

    static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            guard let parsed = date(fromISO: raw) else {
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Not an ISO-8601 instant: \(raw)"
                )
            }
            return parsed
        }
        return decoder
    }

    static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(iso(from: date))
        }
        return encoder
    }
}
