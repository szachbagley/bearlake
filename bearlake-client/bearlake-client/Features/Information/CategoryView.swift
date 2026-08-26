//
//  CategoryView.swift
//  bearlake-client
//

import SwiftUI

/// Articles within a category (storyboard, spec §8.7).
struct CategoryView: View {
    let auth: AuthViewModel
    @State private var model: CategoryViewModel
    @State private var isNamingNewArticle = false
    @State private var pendingDeletion: ArticleSummary?

    private let api: BearLakeAPI
    private let cache: CacheStore?

    init(
        auth: AuthViewModel,
        api: BearLakeAPI,
        category: InfoCategory,
        cache: CacheStore?
    ) {
        self.auth = auth
        self.api = api
        self.cache = cache
        _model = State(initialValue: CategoryViewModel(category: category, api: api, cache: cache))
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
            if model.articles.isEmpty, model.hasLoadedOnce,
               model.isLoading == false, model.errorMessage == nil {
                ContentUnavailableView(
                    "No Articles",
                    systemImage: "doc.text",
                    description: Text(
                        auth.isAdmin
                            ? "Add one with the plus button."
                            : "Articles in this category will appear here."
                    )
                )
            }

            ForEach(model.articles) { article in
                NavigationLink {
                    ArticleView(
                        auth: auth, api: api,
                        articleID: article.id, title: article.title,
                        // Passed down so the editor's category picker has
                        // something to offer without refetching.
                        categories: [model.category],
                        cache: cache
                    )
                } label: {
                    HStack {
                        Text(article.title)
                        Spacer()
                        // Only drafts are badged, and only an admin ever
                        // receives one — it doubles as a reminder that the
                        // family cannot see this yet (C38).
                        if model.showsDraftBadge(for: article) {
                            Text("Draft")
                                .font(.caption2)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.secondary.opacity(0.2))
                                .clipShape(Capsule())
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
                .swipeActions(edge: .trailing) {
                    if canMutate {
                        Button(role: .destructive) {
                            pendingDeletion = article
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }
        }
        .navigationTitle(model.category.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load() }
        .refreshable { await model.load() }
        .toolbar {
            if canMutate {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        isNamingNewArticle = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("New article")
                }
            }
        }
        .sheet(isPresented: $isNamingNewArticle) {
            // Title only. The article is created as a draft immediately and
            // the editor opens against the persisted row, because
            // POST /uploads/presign needs an existing articleId.
            TextEntrySheet(
                title: "New Article",
                placeholder: "Article title",
                characterLimit: Limits.articleTitleMax,
                isMultiline: false,
                validate: CategoryViewModel.titleProblem,
                onSave: { title in await model.createDraft(title: title) != nil },
                onCancel: { isNamingNewArticle = false }
            )
        }
        .confirmationDialog(
            "Delete this article?",
            isPresented: Binding(
                get: { pendingDeletion != nil },
                set: { if $0 == false { pendingDeletion = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let article = pendingDeletion {
                    pendingDeletion = nil
                    Task { await model.deleteArticle(article) }
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

#Preview("Admin") {
    NavigationStack {
        CategoryView(
            auth: .preview(), api: PreviewAPI(),
            category: InfoCategory(
                id: "cat0", title: "Pool & Hot Tub", sortOrder: 0,
                createdAt: Date(), updatedAt: Date()
            ),
            cache: nil
        )
    }
}

#Preview("Member") {
    NavigationStack {
        CategoryView(
            auth: .preview(user: .previewMember), api: PreviewAPI(user: .previewMember),
            category: InfoCategory(
                id: "cat0", title: "Pool & Hot Tub", sortOrder: 0,
                createdAt: Date(), updatedAt: Date()
            ),
            cache: nil
        )
    }
}
