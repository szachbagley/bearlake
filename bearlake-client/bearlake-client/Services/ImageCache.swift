//
//  ImageCache.swift
//  bearlake-client
//

import Foundation
import UIKit

/// Decoded article images, cached by their **S3 key** (C35).
///
/// Keying on the key rather than the URL is the whole point. The API resolves
/// a stored key into a presigned URL at read time, and that URL is different
/// on every single response and expires in 15 minutes. A URL-keyed cache
/// therefore never hits and grows without bound — it looks like it works
/// while doing nothing but leak.
///
/// An `actor` because several block views can ask for the same image at once
/// while a list scrolls.
actor ImageCache {
    /// Injected so tests never touch the network.
    typealias Loader = @Sendable (URL) async throws -> Data

    private var cached: [String: UIImage] = [:]
    /// In-flight loads, so two views appearing together fetch once rather
    /// than twice.
    private var inFlight: [String: Task<UIImage, Error>] = [:]
    private let loader: Loader
    private let countLimit: Int
    /// Insertion order, for evicting the oldest when the limit is reached.
    private var keyOrder: [String] = []

    init(
        countLimit: Int = 60,
        loader: @escaping Loader = { url in
            try await URLSession.shared.data(from: url).0
        }
    ) {
        self.countLimit = countLimit
        self.loader = loader
    }

    /// - Parameters:
    ///   - key: the S3 object key stored on the block. The cache identity.
    ///   - url: the presigned URL from *this* response. Used only to fetch,
    ///     never to identify.
    func image(forKey key: String, url: URL) async throws -> UIImage {
        if let hit = cached[key] { return hit }
        if let existing = inFlight[key] { return try await existing.value }

        let task = Task<UIImage, Error> { [loader] in
            let data = try await loader(url)
            guard let image = UIImage(data: data) else {
                throw ImageCacheError.undecodable
            }
            return image
        }
        inFlight[key] = task

        do {
            let image = try await task.value
            inFlight[key] = nil
            store(image, forKey: key)
            return image
        } catch {
            // Not cached: a failure here is usually an expired URL, and the
            // next read carries a fresh one. Caching the failure would make a
            // recoverable problem permanent.
            inFlight[key] = nil
            throw error
        }
    }

    func cachedImage(forKey key: String) -> UIImage? { cached[key] }

    var count: Int { cached.count }

    func clear() {
        cached.removeAll()
        keyOrder.removeAll()
    }

    private func store(_ image: UIImage, forKey key: String) {
        if cached[key] == nil { keyOrder.append(key) }
        cached[key] = image
        while keyOrder.count > countLimit, let oldest = keyOrder.first {
            keyOrder.removeFirst()
            cached[oldest] = nil
        }
    }
}

enum ImageCacheError: Error, Equatable {
    /// The bytes arrived but were not an image the system could decode.
    case undecodable
}
