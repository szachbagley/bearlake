//
//  HomeView.swift
//  bearlake-client
//

import SwiftUI

/// The landing screen (storyboard, spec §8.1): recent announcements, then the
/// next three events, each section with a footer link to its full list.
struct HomeView: View {
    let auth: AuthViewModel
    @State private var model: HomeViewModel
    @State private var composing: AnnouncementDraft?

    private let api: BearLakeAPI
    private let cache: CacheStore?

    init(auth: AuthViewModel, api: BearLakeAPI, cache: CacheStore?) {
        self.auth = auth
        self.api = api
        self.cache = cache
        _model = State(initialValue: HomeViewModel(api: api, cache: cache))
    }


    /// C48 still applies: this hides controls, it is not the security
    /// boundary. Offline it also prevents starting an edit that cannot
    /// possibly reach the server (C46).
    private var canMutate: Bool { auth.isAdmin && model.isOffline == false }

    var body: some View {
        List {
            if model.isOffline {
                Section { OfflineBanner() }
            }
            announcementsSection
            upcomingSection
        }
        .navigationTitle("Bear Lake")
        .refreshable { await model.load() }
        // Loaded in .task, not .onAppear, so it cancels with the view and
        // does not refire on every re-appearance.
        .task { await model.load() }
        .alert(
            "Something went wrong",
            isPresented: Binding(
                get: { model.errorMessage != nil },
                set: { if $0 == false { model.errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
            Button("Try Again") { Task { await model.load() } }
        } message: {
            Text(model.errorMessage ?? "")
        }
        .sheet(item: $composing) { draft in
            AnnouncementEditorView(api: api, draft: draft) { _ in
                composing = nil
                // Refetch rather than splicing: Home shows only the newest
                // few, so a new announcement changes which ones qualify.
                Task { await model.load() }
            }
        }
    }

    // MARK: - Announcements

    private var announcementsSection: some View {
        Section {
            if model.announcements.isEmpty {
                if model.isLoading {
                    ProgressView().frame(maxWidth: .infinity)
                } else if model.errorMessage == nil {
                    // Only truthful when the load actually succeeded. A
                    // failed fetch with nothing cached leaves the list empty
                    // too, and "there is nothing here" is a different claim
                    // from "we could not ask" (C46).
                    Text("No announcements yet.")
                        .foregroundStyle(.secondary)
                }
            } else {
                ForEach(model.announcements) { announcement in
                    AnnouncementRow(
                        date: model.dateLabel(for: announcement),
                        text: announcement.body
                    )
                }
            }
        } header: {
            HStack {
                Text("Announcements")
                Spacer()
                // Admin-only affordance. This hides a control; it is NOT the
                // security boundary — the server independently rejects a
                // non-admin POST (C48).
                if canMutate {
                    Button {
                        composing = AnnouncementDraft(existing: nil)
                    } label: {
                        Label("New Announcement", systemImage: "plus")
                            .labelStyle(.iconOnly)
                    }
                    .accessibilityLabel("New announcement")
                }
            }
        } footer: {
            NavigationLink {
                AllAnnouncementsView(auth: auth, api: api, cache: cache)
            } label: {
                Text("Older announcements")
            }
        }
    }

    // MARK: - Upcoming

    private var upcomingSection: some View {
        Section {
            if model.upcoming.isEmpty {
                if model.isLoading {
                    ProgressView().frame(maxWidth: .infinity)
                } else if model.errorMessage == nil {
                    Text("Nothing on the calendar yet.")
                        .foregroundStyle(.secondary)
                }
            } else {
                ForEach(model.upcoming) { event in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.rangeLabel(for: event))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Text(event.title)
                    }
                    .padding(.vertical, 2)
                    .accessibilityElement(children: .combine)
                }
            }
        } header: {
            Text("Upcoming")
        }
    }
}

/// One announcement: its date, then its text.
///
/// The property is `text`, not `body` — `body` is `View`'s own requirement
/// and naming it that shadows the view builder.
struct AnnouncementRow: View {
    let date: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(date)
                .font(.footnote)
                .foregroundStyle(.secondary)
            Text(text)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 2)
        // Read as one item rather than two fragments.
        .accessibilityElement(children: .combine)
    }
}

// Previews are DEBUG-only: the `#Preview` macro's generated code compiles in
// every configuration, and it references `PreviewAPI` / `.preview()`, which
// live behind `#if DEBUG` in PreviewSupport.swift so no test double ever
// reaches a shipping binary. Without this guard the Release build does not
// compile — which is how it stayed broken until Phase 11 built it.
#if DEBUG
#Preview("Admin") {
    NavigationStack {
        HomeView(auth: .preview(), api: PreviewAPI(), cache: nil)
    }
}

#Preview("Member") {
    NavigationStack {
        HomeView(
            auth: .preview(user: .previewMember),
            api: PreviewAPI(user: .previewMember),
            cache: nil
        )
    }
}
#endif
