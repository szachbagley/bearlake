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
    let api: BearLakeAPI

    enum Tab: Hashable {
        case calendar, home, information
    }

    /// nil when the store could not be built — the app still works, it just
    /// has no offline copy this launch (C45: the API is the source of truth).
    var cache: CacheStore?

    @State private var selection: Tab = .home
    @State private var isShowingSettings = false

    var body: some View {
        TabView(selection: $selection) {
            NavigationStack {
                CalendarMonthView(auth: auth, api: api, cache: cache)
                    .toolbar { settingsToolbarItem }
            }
            .tabItem { Label("Calendar", systemImage: "calendar") }
            .tag(Tab.calendar)

            NavigationStack {
                HomeView(auth: auth, api: api, cache: cache)
                    .toolbar { settingsToolbarItem }
            }
            .tabItem { Label("Home", systemImage: "house.fill") }
            .tag(Tab.home)

            NavigationStack {
                InformationView(auth: auth, api: api, cache: cache)
                    .toolbar { settingsToolbarItem }
            }
            .tabItem { Label("Information", systemImage: "lightbulb.fill") }
            .tag(Tab.information)
        }
        .sheet(isPresented: $isShowingSettings) {
            SettingsSheet(auth: auth) { isShowingSettings = false }
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

// Previews are DEBUG-only: the `#Preview` macro's generated code compiles in
// every configuration, and it references `PreviewAPI` / `.preview()`, which
// live behind `#if DEBUG` in PreviewSupport.swift so no test double ever
// reaches a shipping binary. Without this guard the Release build does not
// compile — which is how it stayed broken until Phase 11 built it.
#if DEBUG
#Preview {
    RootTabView(auth: .preview(), api: PreviewAPI())
}
#endif
