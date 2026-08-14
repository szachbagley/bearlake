//
//  ToolchainTests.swift
//  bearlake-clientTests
//

import Testing
@testable import bearlake_client

/// Phase 0, step 9. This asserts nothing about the app — it exists to prove
/// the Swift Testing target is wired up and runs from the command line, so
/// that a red suite in Phase 1 means a real failure rather than a broken
/// harness.
///
/// The `@testable import` above is doing the other half of the work: it only
/// compiles if the test bundle is correctly configured against the app
/// target, which is the part that actually tends to be misconfigured. No test
/// body is needed to check that.
struct ToolchainTests {
    @Test("the test target runs")
    func testTargetRuns() {
        #expect(true)
    }
}
