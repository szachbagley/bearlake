//
//  TestDoubles.swift
//  bearlake-clientTests
//

import Foundation
@testable import bearlake_client

// MARK: - URLProtocol stub

/// Intercepts requests so `APIClient` can be exercised end to end — real
/// `URLRequest` construction, real status handling, real decoding — without a
/// server.
///
/// State is per-instance-of-`Stub`, handed to `URLProtocol` through the
/// session configuration, because `URLProtocol` is instantiated by the
/// loading system and cannot take constructor arguments. A lock guards it:
/// `URLSession` calls in on its own queues, and the concurrency tests below
/// deliberately drive several requests at once.
final class StubState: @unchecked Sendable {
    /// Identifies this state to the URLProtocol. Swift Testing runs suites in
    /// parallel, so a single global "current state" is clobbered by whichever
    /// test started most recently — the first version of this file had that
    /// bug and produced the same test both passing and failing in one run.
    let id = UUID().uuidString

    struct Response {
        let status: Int
        let body: Data
    }

    private let lock = NSLock()
    private var handler: (@Sendable (URLRequest) -> Response)?
    private var recorded: [URLRequest] = []

    func setHandler(_ handler: @escaping @Sendable (URLRequest) -> Response) {
        lock.lock(); defer { lock.unlock() }
        self.handler = handler
    }

    func record(_ request: URLRequest) {
        lock.lock(); defer { lock.unlock() }
        recorded.append(request)
    }

    func respond(to request: URLRequest) -> Response {
        lock.lock()
        let handler = self.handler
        lock.unlock()
        return handler?(request) ?? Response(status: 500, body: Data())
    }

    var requests: [URLRequest] {
        lock.lock(); defer { lock.unlock() }
        return recorded
    }

    func count(path: String) -> Int {
        requests.filter { $0.url?.path.hasSuffix(path) == true }.count
    }

    func reset() {
        lock.lock(); defer { lock.unlock() }
        recorded = []
    }
}

final class StubURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        // `URLProtocol` is instantiated by the loading system and cannot be
        // handed context, so the owning state is identified by a header the
        // session adds to every request.
        guard let id = request.value(forHTTPHeaderField: StubRegistry.headerName),
              let state = StubRegistry.shared.state(for: id)
        else {
            client?.urlProtocol(self, didFailWithError: URLError(.unknown))
            return
        }

        state.record(request)
        let stubbed = state.respond(to: request)

        guard let url = request.url,
              let response = HTTPURLResponse(
                  url: url, statusCode: stubbed.status, httpVersion: "HTTP/1.1", headerFields: nil
              )
        else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }

        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if stubbed.body.isEmpty == false {
            client?.urlProtocol(self, didLoad: stubbed.body)
        }
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

/// A `URLProtocol` that always fails the transport, for the offline path.
final class OfflineURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
    }
    override func stopLoading() {}
}

// MARK: - In-memory secure store

/// Stands in for the Keychain. The real one is entitlement- and
/// process-bound, which makes tests order-dependent and slow.
final class InMemorySecureStore: SecureStore, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String: String] = [:]
    /// Set to make the next save throw, for the "save failed" path.
    var failOnSave = false

    func save(_ value: String, for key: String) throws {
        if failOnSave { throw KeychainError.unexpectedStatus(-1) }
        lock.lock(); defer { lock.unlock() }
        storage[key] = value
    }

    func read(_ key: String) -> String? {
        lock.lock(); defer { lock.unlock() }
        return storage[key]
    }

    func delete(_ key: String) throws {
        lock.lock(); defer { lock.unlock() }
        storage[key] = nil
    }

    var isEmpty: Bool {
        lock.lock(); defer { lock.unlock() }
        return storage.isEmpty
    }
}

// MARK: - Session factory

enum TestSession {
    /// A `URLSession` wired to the stub, with the state attached so each
    /// `StubURLProtocol` instance can find it.
    static func make(_ state: StubState) -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        configuration.httpAdditionalHeaders = [StubRegistry.headerName: state.id]
        StubRegistry.shared.register(state)
        return URLSession(configuration: configuration)
    }

    static func offline() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [OfflineURLProtocol.self]
        return URLSession(configuration: configuration)
    }
}

/// `URLProtocol` cannot be handed per-session context directly, so states are
/// registered here and looked up by an id the session stamps onto every
/// request. Keyed rather than single-valued because Swift Testing runs tests
/// in parallel: several stubbed sessions are alive at once, and a shared
/// "current" slot means one test answers another test's requests.
final class StubRegistry: @unchecked Sendable {
    static let shared = StubRegistry()
    static let headerName = "X-Bearlake-Stub"

    private let lock = NSLock()
    private var states: [String: StubState] = [:]

    func register(_ state: StubState) {
        lock.lock(); defer { lock.unlock() }
        states[state.id] = state
    }

    func state(for id: String) -> StubState? {
        lock.lock(); defer { lock.unlock() }
        return states[id]
    }
}
