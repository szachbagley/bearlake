//
//  ImageCacheTests.swift
//  bearlake-clientTests
//

import Foundation
import UIKit
import Testing
@testable import bearlake_client

/// A 1×1 PNG, so the cache has something real to decode.
private func tinyPNG() -> Data {
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: 1, height: 1))
    let image = renderer.image { context in
        UIColor.blue.setFill()
        context.fill(CGRect(x: 0, y: 0, width: 1, height: 1))
    }
    return image.pngData() ?? Data()
}

/// Counts loads per URL so "did this hit the network" is answerable.
private final class LoadRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var urls: [URL] = []
    var payload: Data = tinyPNG()
    var failure: Error?

    func load(_ url: URL) throws -> Data {
        lock.lock(); urls.append(url); lock.unlock()
        if let failure { throw failure }
        return payload
    }

    var count: Int { lock.lock(); defer { lock.unlock() }; return urls.count }
}

private let keyA = "articles/9f9a1eb9-0000-4000-8000-000000000001/aaaaaaaa-0000-4000-8000-000000000001"
private let keyB = "articles/9f9a1eb9-0000-4000-8000-000000000001/bbbbbbbb-0000-4000-8000-000000000002"

private func presigned(_ key: String, expires: String) -> URL {
    URL(string: "https://bucket.s3.amazonaws.com/\(key)?X-Amz-Expires=900&X-Amz-Signature=\(expires)")!
}

struct ImageCacheTests {
    /// C35, stated as a test. The presigned URL rotates on every read, so a
    /// URL-keyed cache would miss every time and grow without bound. The same
    /// key with two different URLs must fetch once.
    @Test("the same key with different presigned URLs fetches once")
    func cachesByKeyNotURL() async throws {
        let recorder = LoadRecorder()
        let cache = ImageCache(loader: { try recorder.load($0) })

        _ = try await cache.image(forKey: keyA, url: presigned(keyA, expires: "signature-one"))
        _ = try await cache.image(forKey: keyA, url: presigned(keyA, expires: "signature-two"))
        _ = try await cache.image(forKey: keyA, url: presigned(keyA, expires: "signature-three"))

        #expect(recorder.count == 1, "a URL-keyed cache would have fetched three times")
        #expect(await cache.count == 1)
        // The URLs really were different — otherwise this test proves nothing.
        #expect(Set([
            presigned(keyA, expires: "signature-one"),
            presigned(keyA, expires: "signature-two"),
        ]).count == 2)
    }

    @Test("different keys are cached separately")
    func differentKeysFetchSeparately() async throws {
        let recorder = LoadRecorder()
        let cache = ImageCache(loader: { try recorder.load($0) })

        _ = try await cache.image(forKey: keyA, url: presigned(keyA, expires: "a"))
        _ = try await cache.image(forKey: keyB, url: presigned(keyB, expires: "b"))

        #expect(recorder.count == 2)
        #expect(await cache.count == 2)
    }

    /// Two block views appearing at once must not both fetch.
    @Test("concurrent requests for one key coalesce into a single load")
    func concurrentRequestsCoalesce() async throws {
        let recorder = LoadRecorder()
        let cache = ImageCache(loader: { url in
            try await Task.sleep(for: .milliseconds(80))
            return try recorder.load(url)
        })

        async let first = cache.image(forKey: keyA, url: presigned(keyA, expires: "a"))
        async let second = cache.image(forKey: keyA, url: presigned(keyA, expires: "b"))
        async let third = cache.image(forKey: keyA, url: presigned(keyA, expires: "c"))
        _ = try await [first, second, third]

        #expect(recorder.count == 1, "three simultaneous requests, one fetch")
    }

    /// A failed fetch is usually an expired URL, and the next read carries a
    /// fresh one. Caching the failure would make a recoverable problem
    /// permanent.
    @Test("a failure is not cached, so a later attempt can succeed")
    func failuresAreNotCached() async throws {
        let recorder = LoadRecorder()
        recorder.failure = URLError(.timedOut)
        let cache = ImageCache(loader: { try recorder.load($0) })

        await #expect(throws: (any Error).self) {
            _ = try await cache.image(forKey: keyA, url: presigned(keyA, expires: "expired"))
        }
        #expect(await cache.count == 0, "nothing cached")

        recorder.failure = nil
        _ = try await cache.image(forKey: keyA, url: presigned(keyA, expires: "fresh"))
        #expect(recorder.count == 2, "it tried again rather than replaying the failure")
        #expect(await cache.count == 1)
    }

    @Test("bytes that are not an image surface as a decode failure")
    func undecodableBytes() async throws {
        let recorder = LoadRecorder()
        recorder.payload = Data("<html>403 expired</html>".utf8)
        let cache = ImageCache(loader: { try recorder.load($0) })

        await #expect(throws: ImageCacheError.undecodable) {
            _ = try await cache.image(forKey: keyA, url: presigned(keyA, expires: "x"))
        }
    }

    /// The cache is a convenience, not storage — it must not grow forever in
    /// a long-lived app.
    @Test("the cache evicts oldest entries past its limit")
    func evictsPastLimit() async throws {
        let recorder = LoadRecorder()
        let cache = ImageCache(countLimit: 3, loader: { try recorder.load($0) })

        for index in 0..<5 {
            let key = "articles/x/\(index)"
            _ = try await cache.image(forKey: key, url: presigned(key, expires: "s"))
        }

        #expect(await cache.count == 3)
        #expect(await cache.cachedImage(forKey: "articles/x/0") == nil, "oldest evicted")
        #expect(await cache.cachedImage(forKey: "articles/x/4") != nil, "newest kept")
    }

    @Test("a cached image is returned without any load")
    func cachedImageLookup() async throws {
        let recorder = LoadRecorder()
        let cache = ImageCache(loader: { try recorder.load($0) })
        #expect(await cache.cachedImage(forKey: keyA) == nil)

        _ = try await cache.image(forKey: keyA, url: presigned(keyA, expires: "a"))
        #expect(await cache.cachedImage(forKey: keyA) != nil)
        #expect(recorder.count == 1)
    }
}
