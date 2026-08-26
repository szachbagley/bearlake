//
//  InformationView.swift
//  bearlake-client
//

import SwiftUI

/// The Information tab (storyboard, spec §8.6): quick tips, then the
/// knowledge base categories.
struct InformationView: View {
    let auth: AuthViewModel
    @State private var model: InformationViewModel

    @State private var editingTip: QuickTipDraft?
    @State private var editingCategory: CategoryDraft?
    @State private var pendingTipDeletion: QuickTip?
    @State private var pendingCategoryDeletion: InfoCategory?

    private let api: BearLakeAPI
    private let cache: CacheStore?

    init(auth: AuthViewModel, api: BearLakeAPI, cache: CacheStore?) {
        self.auth = auth
        self.api = api
        self.cache = cache
        _model = State(initialValue: InformationViewModel(api: api, cache: cache))
    }

    /// Identifiable wrappers so `.sheet(item:)` can tell "new" from "editing
    /// this one".
    struct QuickTipDraft: Identifiable {
        let existing: QuickTip?
        var id: String { existing?.id ?? "new" }
    }
    struct CategoryDraft: Identifiable {
        let existing: InfoCategory?
        var id: String { existing?.id ?? "new" }
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
            quickTipsSection
            knowledgeBaseSection
        }
        .navigationTitle("Information")
        .task { await model.load() }
        .refreshable { await model.load() }
        .sheet(item: $editingTip) { draft in
            TextEntrySheet(
                title: draft.existing == nil ? "New Quick Tip" : "Edit Quick Tip",
                placeholder: "Quick tip",
                initialText: draft.existing?.body ?? "",
                characterLimit: Limits.quickTipBodyMax,
                validate: InformationViewModel.quickTipProblem(body:),
                onSave: { await model.saveQuickTip($0, existing: draft.existing) },
                onCancel: { editingTip = nil }
            )
        }
        .sheet(item: $editingCategory) { draft in
            TextEntrySheet(
                title: draft.existing == nil ? "New Category" : "Rename Category",
                placeholder: "Category name",
                initialText: draft.existing?.title ?? "",
                characterLimit: Limits.categoryTitleMax,
                isMultiline: false,
                validate: InformationViewModel.categoryProblem(title:),
                onSave: { await model.saveCategory($0, existing: draft.existing) },
                onCancel: { editingCategory = nil }
            )
        }
        .confirmationDialog(
            "Delete this quick tip?",
            isPresented: Binding(
                get: { pendingTipDeletion != nil },
                set: { if $0 == false { pendingTipDeletion = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let tip = pendingTipDeletion {
                    pendingTipDeletion = nil
                    Task { await model.deleteQuickTip(tip) }
                }
            }
            Button("Cancel", role: .cancel) { pendingTipDeletion = nil }
        } message: {
            Text("This can't be undone.")
        }
        .confirmationDialog(
            "Delete this category?",
            isPresented: Binding(
                get: { pendingCategoryDeletion != nil },
                set: { if $0 == false { pendingCategoryDeletion = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let category = pendingCategoryDeletion {
                    pendingCategoryDeletion = nil
                    Task { await model.deleteCategory(category) }
                }
            }
            Button("Cancel", role: .cancel) { pendingCategoryDeletion = nil }
        } message: {
            Text("A category has to be empty before it can be deleted.")
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

    // MARK: - Quick tips

    private var quickTipsSection: some View {
        Section {
            if model.quickTips.isEmpty {
                if model.isLoading {
                    ProgressView().frame(maxWidth: .infinity)
                } else if model.errorMessage == nil {
                    // Only truthful when the load actually succeeded. A
                    // failed fetch with nothing cached leaves the list empty
                    // too, and "there is nothing here" is a different claim
                    // from "we could not ask" (C46).
                    Text("No quick tips yet.").foregroundStyle(.secondary)
                }
            } else {
                ForEach(model.quickTips) { tip in
                    Text(tip.body)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.vertical, 2)
                        .swipeActions(edge: .trailing) {
                            // Admin-only affordance; the server rejects a
                            // non-admin write regardless (C48).
                            if canMutate {
                                Button(role: .destructive) {
                                    pendingTipDeletion = tip
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                                Button {
                                    editingTip = QuickTipDraft(existing: tip)
                                } label: {
                                    Label("Edit", systemImage: "pencil")
                                }
                                .tint(.accentColor)
                            }
                        }
                }
            }
        } header: {
            HStack {
                Text("Quick tips")
                Spacer()
                if canMutate {
                    Button {
                        editingTip = QuickTipDraft(existing: nil)
                    } label: {
                        Label("New Quick Tip", systemImage: "plus").labelStyle(.iconOnly)
                    }
                    .accessibilityLabel("New quick tip")
                }
            }
        }
    }

    // MARK: - Knowledge base

    private var knowledgeBaseSection: some View {
        Section {
            if model.categories.isEmpty {
                if model.isLoading {
                    ProgressView().frame(maxWidth: .infinity)
                } else if model.errorMessage == nil {
                    Text("No categories yet.").foregroundStyle(.secondary)
                }
            } else {
                ForEach(model.categories) { category in
                    NavigationLink {
                        CategoryView(auth: auth, api: api, category: category, cache: cache)
                    } label: {
                        Text(category.title)
                    }
                    .swipeActions(edge: .trailing) {
                        if canMutate {
                            Button(role: .destructive) {
                                pendingCategoryDeletion = category
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                            Button {
                                editingCategory = CategoryDraft(existing: category)
                            } label: {
                                Label("Rename", systemImage: "pencil")
                            }
                            .tint(.accentColor)
                        }
                    }
                }
            }
        } header: {
            HStack {
                Text("Knowledge base")
                Spacer()
                if canMutate {
                    Button {
                        editingCategory = CategoryDraft(existing: nil)
                    } label: {
                        Label("New Category", systemImage: "plus").labelStyle(.iconOnly)
                    }
                    .accessibilityLabel("New category")
                }
            }
        }
    }
}

#Preview("Admin") {
    NavigationStack {
        InformationView(auth: .preview(), api: PreviewAPI(), cache: nil)
    }
}

#Preview("Member") {
    NavigationStack {
        InformationView(
            auth: .preview(user: .previewMember),
            api: PreviewAPI(user: .previewMember),
            cache: nil
        )
    }
}
