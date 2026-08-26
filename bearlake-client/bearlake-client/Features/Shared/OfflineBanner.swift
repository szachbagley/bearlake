//
//  OfflineBanner.swift
//  bearlake-client
//
//  Phase 10, step 3. The C46 banner.
//

import SwiftUI

/// Says the screen is showing a saved copy, in the one place every screen
/// can reuse.
///
/// Deliberately not an alert: an alert demands a dismissal for something the
/// user cannot act on, and it would fire again on every failed refresh.
/// A banner states the situation and stays out of the way.
struct OfflineBanner: View {
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "wifi.slash")
                .foregroundStyle(.secondary)
            Text("You're offline. Showing the last saved copy.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
        // Combined so VoiceOver reads one sentence rather than an unlabelled
        // icon followed by text.
        .accessibilityElement(children: .combine)
        .accessibilityLabel("You are offline. Showing the last saved copy.")
    }
}

#Preview {
    List {
        Section { OfflineBanner() }
        Section("Announcements") {
            Text("The marina code changed.")
        }
    }
}
