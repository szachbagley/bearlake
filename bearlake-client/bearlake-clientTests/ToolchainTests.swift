//
//  ToolchainTests.swift
//  bearlake-clientTests
//

import Foundation
import Testing
@testable import bearlake_client

/// Verifies the test harness and the generated app bundle's release contract.
/// Keep these checks against the built Info.plist so an Xcode setting regression
/// is caught in both Debug and Release test runs.
struct ToolchainTests {
    @Test("the built app supports the iPhone device family only")
    func iPhoneOnlyDeviceFamily() {
        #expect(Bundle.main.object(forInfoDictionaryKey: "UIDeviceFamily") as? [Int] == [1])
    }

    @Test("iPhone orientation support is preserved")
    func iPhoneOrientations() {
        let orientations = Bundle.main.object(forInfoDictionaryKey: "UISupportedInterfaceOrientations~iphone") as? [String]
        #expect(orientations == [
            "UIInterfaceOrientationPortrait",
            "UIInterfaceOrientationLandscapeLeft",
            "UIInterfaceOrientationLandscapeRight"
        ])
        #expect(Bundle.main.object(forInfoDictionaryKey: "UISupportedInterfaceOrientations~ipad") == nil)
    }

    @Test("the test target runs")
    func testTargetRuns() {
        #expect(true)
    }
}
