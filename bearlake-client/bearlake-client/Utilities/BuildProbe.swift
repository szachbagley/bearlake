//
//  BuildProbe.swift
//  bearlake-client
//
//  THROWAWAY — delete once the Phase 0 build passes (plan Phase 0, step 8).
//

import Foundation

/// Evidence for C5: this file was created from the command line, in a folder
/// that does not appear anywhere in `project.pbxproj`, and was never added to
/// the target through Xcode. `PlaceholderView` references `confirmation`.
///
/// If the app builds, files under `bearlake-client/bearlake-client/` auto-add
/// to the target and no GUI step is needed to create Swift files. If instead
/// the build fails with "cannot find 'BuildProbe' in scope", C5 is wrong and
/// the plan's file-creation workflow needs rethinking before Phase 1.
enum BuildProbe {
    static let confirmation = "Files auto-add \u{2014} C5 confirmed"
}
