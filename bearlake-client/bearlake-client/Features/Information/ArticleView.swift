//
//  ArticleView.swift
//  bearlake-client
//

import SwiftUI

/// Renders an article's blocks in order (spec §8.8).
struct ArticleView: View {
    let auth: AuthViewModel
    @State private var model: ArticleViewModel

    /// One cache per article view: the images on a page are fetched together
    /// and released together when it closes.
    @State private var cache = ImageCache()

    init(auth: AuthViewModel, api: BearLakeAPI, articleID: String, title: String) {
        self.auth = auth
        _model = State(
            initialValue: ArticleViewModel(articleID: articleID, initialTitle: title, api: api)
        )
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if model.isLoading && model.hasLoadedOnce == false {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                } else if model.isEntirelyUnrenderable {
                    unsupported
                } else if model.isEmpty {
                    empty
                } else {
                    ForEach(model.blocks) { block in
                        BlockView(block: block, cache: cache)
                    }
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle(model.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load() }
        .refreshable { await model.load() }
        .toolbar {
            // Admin-only affordance; the server rejects a non-admin PATCH
            // regardless (C48).
            if auth.isAdmin {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        // Phase 9 supplies the editor.
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                    .accessibilityLabel("Edit article")
                    .disabled(model.article == nil)
                }
            }
        }
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
    }

    private var empty: some View {
        ContentUnavailableView(
            "Nothing here yet",
            systemImage: "doc.text",
            description: Text(
                auth.isAdmin
                    ? "Add some content with the edit button."
                    : "This article hasn't been written yet."
            )
        )
    }

    /// Every block is a type this build cannot render — only reachable after
    /// a future schema addition. Saying so beats a blank page.
    private var unsupported: some View {
        ContentUnavailableView(
            "Update to see this",
            systemImage: "arrow.up.circle",
            description: Text("This article uses something a newer version of the app can show.")
        )
    }
}

#Preview {
    NavigationStack {
        ArticleView(
            auth: .preview(), api: PreviewAPI(),
            articleID: "a1", title: "Monitoring chemicals"
        )
    }
}
