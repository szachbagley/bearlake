//
//  RootTabView.swift
//  bearlake-client
//

import SwiftUI

/// The signed-in shell (C47).
///
/// Calendar | Home | Information, opening on **Home**, with a
/// `NavigationStack` per tab so each keeps its own back history. Straight
/// from the storyboard, which shows the tab bar on every screen and Home
/// selected by default.
struct RootTabView: View {
    let auth: AuthViewModel

    enum Tab: Hashable {
        case calendar, home, information
    }

    @State private var selection: Tab = .home
    @State private var isShowingSettings = false

    var body: some View {
        TabView(selection: $selection) {
            placeholder(title: "Calendar", symbol: "calendar")
                .tabItem { Label("Calendar", systemImage: "calendar") }
                .tag(Tab.calendar)

            placeholder(title: "Bear Lake", symbol: "house.fill")
                .tabItem { Label("Home", systemImage: "house.fill") }
                .tag(Tab.home)

            placeholder(title: "Information", symbol: "lightbulb.fill")
                .tabItem { Label("Information", systemImage: "lightbulb.fill") }
                .tag(Tab.information)
        }
        .sheet(isPresented: $isShowingSettings) {
            SettingsSheet(auth: auth) { isShowingSettings = false }
        }
    }

    /// Phase 3 ships the shell; Phases 4–9 replace these with the real
    /// screens. Each keeps the ☰ control so the settings path is reachable
    /// and testable now.
    private func placeholder(title: String, symbol: String) -> some View {
        NavigationStack {
            ContentUnavailableView(
                title,
                systemImage: symbol,
                description: Text("Coming in a later phase.")
            )
            .navigationTitle(title)
            .toolbar { settingsToolbarItem }
        }
    }

    private var settingsToolbarItem: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                isShowingSettings = true
            } label: {
                Label("Settings", systemImage: "line.3.horizontal")
            }
            .accessibilityLabel("Settings")
        }
    }
}

#Preview {
    RootTabView(auth: .preview())
}
