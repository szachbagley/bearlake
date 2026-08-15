//
//  BearLakeApp.swift
//  bearlake-client
//

import SwiftUI

@main
struct BearLakeApp: App {
    var body: some Scene {
        WindowGroup {
            PlaceholderView()
        }
    }
}

/// Phase 0 placeholder. Replaced in Phase 2 by the real root switch
/// (login vs. tab shell) once auth exists.
struct PlaceholderView: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "house.and.flag")
                .font(.largeTitle)
                .foregroundStyle(.tint)
            Text("Bear Lake")
                .font(.title)
        }
        .padding()
    }
}

#Preview {
    PlaceholderView()
}
