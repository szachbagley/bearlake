//
//  AllAnnouncementsView.swift
//  bearlake-client
//

import SwiftUI

/// The full reverse-chronological list, paged by the server's opaque cursor.
struct AllAnnouncementsView: View {
    let auth: AuthViewModel
    @State private var model: AnnouncementsViewModel
    @State private var composing: AnnouncementDraft?
    @State private var pendingDeletion: Announcement?

    private let api: BearLakeAPI

    init(auth: AuthViewModel, api: BearLakeAPI, cache: CacheStore?) {
        self.auth = auth
        self.api = api
        _model = State(initialValue: AnnouncementsViewModel(api: api, cache: cache))
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
            // errorMessage guards against claiming the list is empty when
            // the fetch failed and there was nothing cached (C46).
            if model.announcements.isEmpty, model.hasLoadedOnce,
               model.isLoading == false, model.errorMessage == nil {
                ContentUnavailableView(
                    "No Announcements",
                    systemImage: "megaphone",
                    description: Text("Announcements from the family will appear here.")
                )
            }

            ForEach(model.announcements) { announcement in
                AnnouncementRow(
                    date: model.dateLabel(for: announcement),
                    text: announcement.body
                )
                .swipeActions(edge: .trailing) {
                    // Hidden for members; the server rejects them regardless
                    // (C48).
                    if canMutate {
                        Button(role: .destructive) {
                            pendingDeletion = announcement
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                        Button {
                            composing = AnnouncementDraft(existing: announcement)
                        } label: {
                            Label("Edit", systemImage: "pencil")
                        }
                        .tint(.accentColor)
                    }
                }
            }

            if model.nextCursor != nil {
                Button {
                    Task { await model.loadMore() }
                } label: {
                    HStack {
                        Spacer()
                        if model.isLoadingMore {
                            ProgressView()
                        } else {
                            Text("Load More")
                        }
                        Spacer()
                    }
                }
                .disabled(model.canLoadMore == false)
            }
        }
        .navigationTitle("Announcements")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.load() }
        .task { await model.load() }
        .toolbar {
            if canMutate {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        composing = AnnouncementDraft(existing: nil)
                    } label: {
                        Label("New Announcement", systemImage: "plus")
                    }
                    .accessibilityLabel("New announcement")
                }
            }
        }
        .sheet(item: $composing) { draft in
            AnnouncementEditorView(api: api, draft: draft) { saved in
                composing = nil
                if let saved { model.merge(saved) }
            }
        }
        // Hard delete with no undo, so it confirms first.
        .confirmationDialog(
            "Delete this announcement?",
            isPresented: Binding(
                get: { pendingDeletion != nil },
                set: { if $0 == false { pendingDeletion = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let target = pendingDeletion {
                    pendingDeletion = nil
                    Task { await model.delete(target) }
                }
            }
            Button("Cancel", role: .cancel) { pendingDeletion = nil }
        } message: {
            Text("This can't be undone.")
        }
        .alert(
            "Something went wrong",
            isPresented: Binding(
                get: { model.errorMessage != nil },
                set: { if $0 == false { model.errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.errorMessage ?? "")
        }
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
        AllAnnouncementsView(auth: .preview(), api: PreviewAPI(), cache: nil)
    }
}

#Preview("Member") {
    NavigationStack {
        AllAnnouncementsView(
            auth: .preview(user: .previewMember),
            api: PreviewAPI(user: .previewMember),
            cache: nil
        )
    }
}
#endif
