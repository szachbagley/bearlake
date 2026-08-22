//
//  KeychainStore.swift
//  bearlake-client
//

import Foundation
import Security

/// Somewhere to keep the refresh token. Abstracted so tests can substitute an
/// in-memory double — the real Keychain is process- and entitlement-bound and
/// makes tests order-dependent.
protocol SecureStore: Sendable {
    func save(_ value: String, for key: String) throws
    func read(_ key: String) -> String?
    func delete(_ key: String) throws
}

enum KeychainError: Error, Equatable {
    case unexpectedStatus(OSStatus)
}

/// The real Keychain (C20).
///
/// The refresh token lives here and never in `UserDefaults`, which is an
/// unprotected plist any file-level access can read. The access token is
/// never written here at all — it lives in memory only, and persisting a
/// 15-minute credential buys nothing.
struct KeychainStore: SecureStore {
    static let refreshTokenKey = "bearlake.refreshToken"

    private let service: String

    init(service: String = Bundle.main.bundleIdentifier ?? "hansen.bearlake-client") {
        self.service = service
    }

    private func query(for key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }

    func save(_ value: String, for key: String) throws {
        let data = Data(value.utf8)

        // Update in place when an item already exists. SecItemAdd on a
        // duplicate returns errSecDuplicateItem rather than overwriting, and
        // a delete-then-add would leave no token at all if the process died
        // between the two calls.
        let updateStatus = SecItemUpdate(
            query(for: key) as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        if updateStatus == errSecSuccess { return }

        guard updateStatus == errSecItemNotFound else {
            throw KeychainError.unexpectedStatus(updateStatus)
        }

        var attributes = query(for: key)
        attributes[kSecValueData as String] = data
        // AfterFirstUnlock lets a backgrounded app refresh its session
        // without the device being unlocked, while still protecting a device
        // that has been off since it was last powered on.
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

        let addStatus = SecItemAdd(attributes as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw KeychainError.unexpectedStatus(addStatus)
        }
    }

    func read(_ key: String) -> String? {
        var attributes = query(for: key)
        attributes[kSecReturnData as String] = true
        attributes[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(attributes as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func delete(_ key: String) throws {
        let status = SecItemDelete(query(for: key) as CFDictionary)
        // Deleting something that was never there is the desired end state,
        // not a failure — sign-out must not throw because the user was
        // already signed out.
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unexpectedStatus(status)
        }
    }
}
