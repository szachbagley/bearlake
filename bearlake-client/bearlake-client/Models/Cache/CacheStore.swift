//
//  CacheStore.swift
//  bearlake-client
//
//  Phase 10, step 2. The single door to the SwiftData store.
//
//  Everything above this layer speaks DTOs; the `@Model` classes never leave
//  it. That keeps the cache a swappable implementation detail rather than a
//  second model layer the ViewModels have to know about.
//
//  `@MainActor` because the ViewModels that call it already are, and a
//  `ModelContext` is not `Sendable` — hopping it between actors is how
//  SwiftData corrupts.
//

import Foundation
import SwiftData

@MainActor
final class CacheStore {
    private let context: ModelContext
    private let dates: CabinDate

    init(context: ModelContext, dates: CabinDate = CabinDate()) {
        self.context = context
        self.dates = dates
    }

    /// Builds the on-disk store, falling back to an in-memory one.
    ///
    /// A cache that cannot be created must never take the app down with it —
    /// the API is the source of truth (C45), so the worst case of a failed
    /// container is that offline viewing does not work this launch.
    static func makeContainer(inMemory: Bool = false) -> ModelContainer? {
        let schema = Schema(CacheSchema.models)
        let configuration = ModelConfiguration(
            schema: schema, isStoredInMemoryOnly: inMemory
        )
        if let container = try? ModelContainer(for: schema, configurations: configuration) {
            return container
        }
        // A schema change without a migration is the realistic cause. Starting
        // over loses only cached copies of server data.
        if inMemory == false {
            return makeContainer(inMemory: true)
        }
        return nil
    }

    // MARK: - Announcements

    /// - Parameter replacingAll: true for a first page (cursor nil), which is
    ///   the newest N and therefore authoritative; false when appending a
    ///   later page, which must not wipe the pages already held.
    func save(announcements: [Announcement], replacingAll: Bool) {
        if replacingAll {
            deleteAll(CachedAnnouncement.self)
        }
        upsert(announcements, keyedBy: \.id, existing: CachedAnnouncement.self) {
            CachedAnnouncement($0)
        } update: { model, dto in
            model.update(from: dto)
        }
        commit()
    }

    func announcements(limit: Int? = nil) -> [Announcement] {
        var descriptor = FetchDescriptor<CachedAnnouncement>(
            sortBy: [SortDescriptor(\.postedAt, order: .reverse)]
        )
        if let limit { descriptor.fetchLimit = limit }
        return fetch(descriptor).map(\.dto)
    }

    // MARK: - Events

    /// Upserts the window's events and prunes cached events that overlap the
    /// same window but were not returned — those were deleted or moved away.
    ///
    /// Without the prune, a cancelled stay would keep showing offline, and
    /// "is the cabin booked" is the one question this app exists to answer.
    /// Overlap is decided with `CabinDate.event(_:fallsOn:)` rather than a
    /// hand-rolled string comparison, so all-day and timed events are judged
    /// by the same tested rule (C27).
    func save(events: [CalendarEvent], window: ClosedRange<String>?) {
        if let window {
            let returned = Set(events.map(\.id))
            let days = daysIn(window)
            for cached in fetch(FetchDescriptor<CachedEvent>()) {
                guard returned.contains(cached.id) == false else { continue }
                guard let cachedDates = cached.dto.dates else { continue }
                if days.contains(where: { dates.event(cachedDates, fallsOn: $0) }) {
                    context.delete(cached)
                }
            }
        }
        upsert(events, keyedBy: \.id, existing: CachedEvent.self) {
            CachedEvent($0)
        } update: { model, dto in
            model.update(from: dto)
        }
        commit()
    }

    func events() -> [CalendarEvent] {
        fetch(FetchDescriptor<CachedEvent>()).map(\.dto)
    }

    /// Inclusive, and capped: a pathological window must not spin here.
    private func daysIn(_ window: ClosedRange<String>) -> [String] {
        var days: [String] = []
        var day = window.lowerBound
        while day <= window.upperBound, days.count < 400 {
            days.append(day)
            guard let next = dates.dateOnly(day, addingDays: 1) else { break }
            day = next
        }
        return days
    }

    // MARK: - Quick tips

    /// The endpoint returns the whole set, so the response is authoritative
    /// and anything missing from it was deleted.
    func save(quickTips: [QuickTip]) {
        deleteAll(CachedQuickTip.self)
        upsert(quickTips, keyedBy: \.id, existing: CachedQuickTip.self) {
            CachedQuickTip($0)
        } update: { model, dto in
            model.update(from: dto)
        }
        commit()
    }

    func quickTips() -> [QuickTip] {
        fetch(FetchDescriptor<CachedQuickTip>(
            sortBy: [SortDescriptor(\.sortOrder), SortDescriptor(\.createdAt)]
        )).map(\.dto)
    }

    // MARK: - Categories

    func save(categories: [InfoCategory]) {
        deleteAll(CachedCategory.self)
        upsert(categories, keyedBy: \.id, existing: CachedCategory.self) {
            CachedCategory($0)
        } update: { model, dto in
            model.update(from: dto)
        }
        commit()
    }

    func categories() -> [InfoCategory] {
        fetch(FetchDescriptor<CachedCategory>(
            sortBy: [SortDescriptor(\.sortOrder), SortDescriptor(\.title)]
        )).map(\.dto)
    }

    // MARK: - Article summaries

    /// Scoped to one category, which is how the endpoint is scoped. Replacing
    /// the whole table would drop every other category's list.
    func save(articleSummaries: [ArticleSummary], categoryID: String) {
        let predicate = #Predicate<CachedArticleSummary> { $0.categoryId == categoryID }
        for existing in fetch(FetchDescriptor(predicate: predicate)) {
            context.delete(existing)
        }
        upsert(articleSummaries, keyedBy: \.id, existing: CachedArticleSummary.self) {
            CachedArticleSummary($0)
        } update: { model, dto in
            model.update(from: dto)
        }
        commit()
    }

    func articleSummaries(categoryID: String) -> [ArticleSummary] {
        let predicate = #Predicate<CachedArticleSummary> { $0.categoryId == categoryID }
        return fetch(FetchDescriptor(
            predicate: predicate,
            sortBy: [SortDescriptor(\.sortOrder), SortDescriptor(\.title)]
        )).map(\.dto)
    }

    // MARK: - Articles

    func save(article: InfoArticle) {
        let id = article.id
        let predicate = #Predicate<CachedArticle> { $0.id == id }
        if let existing = fetch(FetchDescriptor(predicate: predicate)).first {
            try? existing.update(from: article)
        } else if let model = try? CachedArticle(article) {
            context.insert(model)
        }
        commit()
    }

    func article(id: String) -> InfoArticle? {
        let predicate = #Predicate<CachedArticle> { $0.id == id }
        guard let cached = fetch(FetchDescriptor(predicate: predicate)).first else {
            return nil
        }
        return try? cached.dto
    }

    // MARK: - Sign-out (step 4)

    /// Empties every table. The next user must not see the previous user's
    /// content, and a member must not inherit an admin's cached drafts.
    func clear() {
        // Listed concretely, never by looping `CacheSchema.models`.
        //
        // That array is `[any PersistentModel.Type]`, and handing an
        // *existential* metatype to SwiftData's generic `delete(model:)`
        // forces the runtime to instantiate generic metadata for a
        // `Predicate` it cannot see statically. Debug survives it; an
        // optimised build segfaults inside libswiftCore — which is exactly
        // what the Phase 11 production smoke test hit on sign-out.
        //
        // The consequence was worse than a crash: sign-out is what empties
        // the family's cached gate codes and key locations, so a crash here
        // left them on disk (Phase 10, step 4).
        //
        // If you add a `@Model`, add it here as well — `modelCount` below is
        // the tripwire that fails the test if you forget.
        try? context.delete(model: CachedAnnouncement.self)
        try? context.delete(model: CachedEvent.self)
        try? context.delete(model: CachedQuickTip.self)
        try? context.delete(model: CachedCategory.self)
        try? context.delete(model: CachedArticleSummary.self)
        try? context.delete(model: CachedArticle.self)
        commit()
    }

    var isEmpty: Bool {
        announcements(limit: 1).isEmpty
            && events().isEmpty
            && quickTips().isEmpty
            && categories().isEmpty
            && fetch(FetchDescriptor<CachedArticleSummary>()).isEmpty
            && fetch(FetchDescriptor<CachedArticle>()).isEmpty
    }

    // MARK: - Plumbing

    private func fetch<T: PersistentModel>(_ descriptor: FetchDescriptor<T>) -> [T] {
        (try? context.fetch(descriptor)) ?? []
    }

    /// Generic, not `any PersistentModel.Type`: the concrete type must stay
    /// visible to the compiler so `delete(model:)` specialises rather than
    /// instantiating metadata at runtime. See `clear()`.
    private func deleteAll<T: PersistentModel>(_ type: T.Type) {
        try? context.delete(model: type)
    }

    /// Upsert by server id, so a refetch updates rather than duplicating —
    /// the reason `id` carries `@Attribute(.unique)`.
    private func upsert<DTO, Model: PersistentModel>(
        _ items: [DTO],
        keyedBy id: KeyPath<DTO, String>,
        existing type: Model.Type,
        make: (DTO) -> Model,
        update: (Model, DTO) -> Void
    ) {
        guard items.isEmpty == false else { return }
        var byID: [String: Model] = [:]
        for model in fetch(FetchDescriptor<Model>()) {
            if let key = model.cacheID { byID[key] = model }
        }
        for item in items {
            if let found = byID[item[keyPath: id]] {
                update(found, item)
            } else {
                context.insert(make(item))
            }
        }
    }

    /// Failures are swallowed deliberately: the cache is a convenience, and
    /// the API is the source of truth (C45). A store that cannot save must
    /// not break the screen that just fetched successfully.
    private func commit() {
        try? context.save()
    }
}

/// Lets the generic upsert read an id without a protocol on every model.
private extension PersistentModel {
    var cacheID: String? {
        switch self {
        case let model as CachedAnnouncement: return model.id
        case let model as CachedEvent: return model.id
        case let model as CachedQuickTip: return model.id
        case let model as CachedCategory: return model.id
        case let model as CachedArticleSummary: return model.id
        case let model as CachedArticle: return model.id
        default: return nil
        }
    }
}
