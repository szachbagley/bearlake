//
//  EventEditorViewModel.swift
//  bearlake-client
//

import Foundation
import Observation

@MainActor
@Observable
final class EventEditorViewModel {
    enum Mode: Equatable {
        case create(dateOnly: String)
        case edit(CalendarEvent)
    }

    /// Which field's inline picker is open (storyboard: the picker appears
    /// below the field being edited, and moves when focus moves).
    enum PickerField: Equatable {
        case starts
        case ends
    }

    let mode: Mode

    var title: String
    var notes: String
    var isAllDay: Bool
    /// Always `YYYY-MM-DD`, for both modes (C22).
    var startDay: String
    var endDay: String
    /// Time-of-day only; combined with the day at save time.
    var startTime: Date
    var endTime: Date

    var openPicker: PickerField?
    private(set) var isSaving = false
    var errorMessage: String?

    private let api: BearLakeAPI
    private let dates: CabinDate
    private let original: Snapshot

    /// What the fields held when the editor opened, so "did the user change
    /// anything" is a comparison rather than a guess.
    private struct Snapshot: Equatable {
        let title: String
        let notes: String
        let isAllDay: Bool
        let startDay: String
        let endDay: String
        let startHour: Int
        let endHour: Int
    }

    init(mode: Mode, api: BearLakeAPI, dates: CabinDate = CabinDate()) {
        self.mode = mode
        self.api = api
        self.dates = dates

        // Built as locals first: `original` is a stored property, and reading
        // self.title to populate it before every property is assigned is not
        // allowed.
        let initialTitle: String
        let initialNotes: String
        let initialAllDay: Bool
        let initialStartDay: String
        let initialEndDay: String
        let initialStartTime: Date
        let initialEndTime: Date

        switch mode {
        case .create(let dateOnly):
            initialTitle = ""
            initialNotes = ""
            initialAllDay = false
            initialStartDay = dateOnly
            initialEndDay = dateOnly
            // A one-hour slot late morning: the most common shape for a
            // cabin task, and never accidentally overnight.
            initialStartTime = dates.timeOfDay(hour: 10)
            initialEndTime = dates.timeOfDay(hour: 11)

        case .edit(let event):
            initialTitle = event.title
            initialNotes = event.notes ?? ""
            initialAllDay = event.isAllDay
            switch event.dates {
            case .allDay(let start, let end):
                initialStartDay = start
                initialEndDay = end
                initialStartTime = dates.timeOfDay(hour: 10)
                initialEndTime = dates.timeOfDay(hour: 11)
            case .timed(let start, let end):
                initialStartDay = dates.dateOnlyString(from: start)
                initialEndDay = dates.dateOnlyString(from: end)
                initialStartTime = start
                initialEndTime = end
            case nil:
                initialStartDay = dates.todayDateOnly()
                initialEndDay = dates.todayDateOnly()
                initialStartTime = dates.timeOfDay(hour: 10)
                initialEndTime = dates.timeOfDay(hour: 11)
            }
        }

        title = initialTitle
        notes = initialNotes
        isAllDay = initialAllDay
        startDay = initialStartDay
        endDay = initialEndDay
        startTime = initialStartTime
        endTime = initialEndTime

        original = Snapshot(
            title: initialTitle,
            notes: initialNotes,
            isAllDay: initialAllDay,
            startDay: initialStartDay,
            endDay: initialEndDay,
            startHour: dates.calendar.component(.hour, from: initialStartTime),
            endHour: dates.calendar.component(.hour, from: initialEndTime)
        )
    }

    var isEditing: Bool {
        if case .edit = mode { return true }
        return false
    }

    var eventID: String? {
        if case .edit(let event) = mode { return event.id }
        return nil
    }

    /// Whether anything was entered or changed — drives the discard
    /// confirmation (step 4).
    var hasChanges: Bool {
        current != original
    }

    private var current: Snapshot {
        Snapshot(
            title: title, notes: notes, isAllDay: isAllDay,
            startDay: startDay, endDay: endDay,
            startHour: dates.calendar.component(.hour, from: startTime),
            endHour: dates.calendar.component(.hour, from: endTime)
        )
    }

    // MARK: - All-day toggle (step 2, C24)

    /// Converts the held values so the payload shape always matches
    /// `isAllDay`.
    ///
    /// The two shapes are not interchangeable on the wire — an all-day event
    /// carries date-only strings with an **inclusive** end, a timed one
    /// carries instants with an exclusive end, and mixing them is a server
    /// 400. Rather than trusting whatever the fields happen to hold, the
    /// toggle rewrites them.
    func setAllDay(_ newValue: Bool) {
        guard newValue != isAllDay else { return }
        isAllDay = newValue

        if newValue {
            // Timed → all-day. The days are already correct; the times simply
            // stop being part of the payload. But a timed event ending at
            // exactly midnight belongs to the previous day, and carrying that
            // end forward would silently add a day to the stay.
            if endDay > startDay,
               let end = dates.instant(day: endDay, timeOfDay: endTime),
               dates.calendar.startOfDay(for: end) == end,
               let pulledBack = dates.dateOnly(endDay, addingDays: -1),
               pulledBack >= startDay {
                endDay = pulledBack
            }
        } else {
            // All-day → timed. The days carry over and the times come back.
            // A timed event needs start < end, so a single-day all-day event
            // has to end on the same day at a later hour, not at the same
            // instant.
            if startTime >= endTime {
                startTime = dates.timeOfDay(hour: 10)
                endTime = dates.timeOfDay(hour: 11)
            }
        }
        // Keep the range coherent after either conversion.
        if endDay < startDay { endDay = startDay }
        openPicker = nil
    }

    // MARK: - Validation (step 7)

    /// Mirrors the server's rules so a known-bad value never leaves the
    /// device. The server enforces these too — this only saves a round trip
    /// and gives a better message.
    var validationProblem: String? {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedTitle.count < Limits.eventTitleMin {
            return "An event needs a title."
        }
        if trimmedTitle.count > Limits.eventTitleMax {
            return "That title is too long."
        }
        if notes.count > Limits.eventNotesMax {
            return "Those notes are too long."
        }

        guard let dates = composedDates else {
            return "Those dates aren't valid."
        }
        switch dates {
        case .allDay(let start, let end):
            // Inclusive, so a single-day event is start == end (C25).
            if start > end { return "The end date can't be before the start date." }
        case .timed(let start, let end):
            if start >= end { return "The end time has to be after the start time." }
        }
        return nil
    }

    var canSave: Bool { validationProblem == nil && isSaving == false }

    /// The dates in the shape matching `isAllDay`, ready for the wire.
    var composedDates: EventDates? {
        if isAllDay {
            guard dates.parts(ofDateOnly: startDay) != nil,
                  dates.parts(ofDateOnly: endDay) != nil
            else { return nil }
            return .allDay(start: startDay, end: endDay)
        }
        guard let start = dates.instant(day: startDay, timeOfDay: startTime),
              let end = dates.instant(day: endDay, timeOfDay: endTime)
        else { return nil }
        return .timed(start: start, end: end)
    }

    // MARK: - Display
    //
    // Formatting lives here rather than in the view: a `body` must not do
    // date math (CLAUDE.md), and the view has no business holding a
    // `Calendar`.

    func dayLabel(_ dateOnly: String) -> String {
        dates.dateLabel(forDateOnly: dateOnly)
    }

    func timeLabel(_ time: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = dates.calendar
        formatter.timeZone = dates.timeZone
        formatter.locale = dates.calendar.locale ?? .current
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter.string(from: time)
    }

    /// `DatePicker` needs a `Date`; the string stays authoritative.
    ///
    /// The value is converted only to show the picker, and the picker's
    /// result is turned straight back into a string, so nothing downstream
    /// ever sees the intermediate `Date` (C22).
    func date(forDay dateOnly: String) -> Date {
        guard let components = dates.components(fromDateOnly: dateOnly),
              let date = dates.calendar.date(from: components)
        else { return Date() }
        return date
    }

    func dayString(from date: Date) -> String {
        dates.dateOnlyString(from: date)
    }

    // MARK: - Save and delete

    /// - Returns: the saved event, or nil if it failed.
    func save() async -> CalendarEvent? {
        guard canSave, let composed = composedDates else {
            errorMessage = validationProblem
            return nil
        }
        isSaving = true
        defer { isSaving = false }

        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)

        do {
            if case .edit(let event) = mode {
                var patch = UpdateEventRequest()
                patch.title = trimmedTitle
                // Clearing the notes has to send an explicit null, or the
                // server keeps the old text (see Patchable).
                patch.notes = trimmedNotes.isEmpty ? .setNull : .set(trimmedNotes)
                patch.setDates(composed)
                return try await api.updateEvent(id: event.id, patch)
            }
            return try await api.createEvent(
                CreateEventRequest(
                    title: trimmedTitle,
                    notes: trimmedNotes.isEmpty ? nil : trimmedNotes,
                    dates: composed
                )
            )
        } catch let error as APIError {
            errorMessage = error.message
            return nil
        } catch {
            errorMessage = "Couldn't save that event."
            return nil
        }
    }

    /// - Returns: true when the event was deleted.
    func delete() async -> Bool {
        guard case .edit(let event) = mode else { return false }
        isSaving = true
        defer { isSaving = false }
        do {
            try await api.deleteEvent(id: event.id)
            return true
        } catch let error as APIError {
            errorMessage = error.message
            return false
        } catch {
            errorMessage = "Couldn't delete that event."
            return false
        }
    }
}
