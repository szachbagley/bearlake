//
//  InformationViewModel.swift
//  bearlake-client
//

import Foundation
import Observation

@MainActor
@Observable
final class InformationViewModel {
    private(set) var quickTips: [QuickTip] = []
    private(set) var categories: [InfoCategory] = []
    private(set) var isLoading = false
    private(set) var hasLoadedOnce = false
    var errorMessage: String?

    private let api: BearLakeAPI

    init(api: BearLakeAPI) {
        self.api = api
    }

    var isEmpty: Bool { quickTips.isEmpty && categories.isEmpty }

    func load() async {
        guard isLoading == false else { return }
        isLoading = true
        defer { isLoading = false; hasLoadedOnce = true }

        // The two sections are independent; one failing should not blank the
        // other, so the first error wins the alert and the rest still loads.
        var firstError: String?

        do {
            // Ordered by sortOrder, which the server already applies — the
            // client does not re-sort, so an admin's reordering is the single
            // source of truth.
            quickTips = try await api.listQuickTips()
        } catch let error as APIError {
            firstError = error.message
        } catch {
            firstError = "Couldn't load the quick tips."
        }

        do {
            categories = try await api.listCategories()
        } catch let error as APIError {
            firstError = firstError ?? error.message
        } catch {
            firstError = firstError ?? "Couldn't load the knowledge base."
        }

        errorMessage = firstError
    }

    // MARK: - Quick tips

    /// Why a quick-tip body cannot be saved, or nil when it can.
    ///
    /// A static so the editor's Save button and the tests call the same
    /// function and cannot drift apart.
    static func quickTipProblem(body: String) -> String? {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.count < Limits.quickTipBodyMin { return "A quick tip needs some text." }
        if body.count > Limits.quickTipBodyMax {
            return "That's \(body.count - Limits.quickTipBodyMax) characters too long."
        }
        return nil
    }

    /// - Returns: true on success.
    @discardableResult
    func saveQuickTip(_ body: String, existing: QuickTip?) async -> Bool {
        guard Self.quickTipProblem(body: body) == nil else { return false }
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)

        do {
            if let existing {
                let updated = try await api.updateQuickTip(
                    id: existing.id, UpdateQuickTipRequest(body: trimmed)
                )
                if let index = quickTips.firstIndex(where: { $0.id == existing.id }) {
                    quickTips[index] = updated
                }
            } else {
                // sortOrder is omitted: the server appends. Sending a guess
                // would fight whatever ordering already exists.
                let created = try await api.createQuickTip(CreateQuickTipRequest(body: trimmed))
                quickTips.append(created)
            }
            return true
        } catch let error as APIError {
            errorMessage = error.message
            return false
        } catch {
            errorMessage = "Couldn't save that quick tip."
            return false
        }
    }

    func deleteQuickTip(_ tip: QuickTip) async {
        do {
            try await api.deleteQuickTip(id: tip.id)
            quickTips.removeAll { $0.id == tip.id }
        } catch let error as APIError {
            errorMessage = error.message
        } catch {
            errorMessage = "Couldn't delete that quick tip."
        }
    }

    // MARK: - Categories

    static func categoryProblem(title: String) -> String? {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.count < Limits.categoryTitleMin { return "A category needs a name." }
        if trimmed.count > Limits.categoryTitleMax { return "That name is too long." }
        return nil
    }

    @discardableResult
    func saveCategory(_ title: String, existing: InfoCategory?) async -> Bool {
        guard Self.categoryProblem(title: title) == nil else { return false }
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)

        do {
            if let existing {
                let updated = try await api.updateCategory(
                    id: existing.id, UpdateCategoryRequest(title: trimmed)
                )
                if let index = categories.firstIndex(where: { $0.id == existing.id }) {
                    categories[index] = updated
                }
            } else {
                let created = try await api.createCategory(CreateCategoryRequest(title: trimmed))
                categories.append(created)
            }
            return true
        } catch let error as APIError {
            errorMessage = error.message
            return false
        } catch {
            errorMessage = "Couldn't save that category."
            return false
        }
    }

    func deleteCategory(_ category: InfoCategory) async {
        do {
            try await api.deleteCategory(id: category.id)
            categories.removeAll { $0.id == category.id }
        } catch let error as APIError {
            // CATEGORY_NOT_EMPTY carries specific guidance — that the
            // articles have to go first. Replacing it with a generic failure
            // would leave the admin with no idea what to do next, which is
            // the whole reason C17 keeps the server's message.
            errorMessage = error.message
        } catch {
            errorMessage = "Couldn't delete that category."
        }
    }
}
