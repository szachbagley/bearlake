//
//  EventEditorView.swift
//  bearlake-client
//

import SwiftUI

/// Create and edit, one view (storyboard). Edit mode pre-populates and adds
/// **Delete Event**; create mode never shows it.
struct EventEditorView: View {
    @State private var model: EventEditorViewModel
    var onFinished: @MainActor (CalendarEvent?) -> Void
    /// Distinct from `onFinished` so the caller can drop a deleted event from
    /// its list rather than merging it back in.
    var onDeleted: @MainActor (String) -> Void = { _ in }

    @State private var isConfirmingDiscard = false
    @State private var isConfirmingDelete = false
    @FocusState private var isTitleFocused: Bool

    init(
        mode: EventEditorViewModel.Mode,
        api: BearLakeAPI,
        dates: CabinDate = CabinDate(),
        onFinished: @escaping @MainActor (CalendarEvent?) -> Void,
        onDeleted: @escaping @MainActor (String) -> Void = { _ in }
    ) {
        _model = State(initialValue: EventEditorViewModel(mode: mode, api: api, dates: dates))
        self.onFinished = onFinished
        self.onDeleted = onDeleted
    }

    var body: some View {
        NavigationStack {
            Form {
                detailsSection
                datesSection
                if model.isEditing { deleteSection }
            }
            .navigationTitle(model.isEditing ? "Edit Event" : "Create Event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                // The storyboard's X and checkmark.
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        if model.hasChanges { isConfirmingDiscard = true } else { onFinished(nil) }
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel(model.isEditing ? "Discard changes" : "Cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    if model.isSaving {
                        ProgressView()
                    } else {
                        Button(action: save) {
                            Image(systemName: "checkmark")
                        }
                        .accessibilityLabel("Save")
                        .disabled(model.canSave == false)
                    }
                }
            }
            .confirmationDialog(
                model.isEditing ? "Discard your changes?" : "Discard this event?",
                isPresented: $isConfirmingDiscard,
                titleVisibility: .visible
            ) {
                Button("Discard", role: .destructive) { onFinished(nil) }
                Button("Keep Editing", role: .cancel) {}
            }
            .confirmationDialog(
                "Delete this event?",
                isPresented: $isConfirmingDelete,
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) { delete() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This can't be undone.")
            }
            .interactiveDismissDisabled(model.hasChanges)
            .disabled(model.isSaving)
            .task { isTitleFocused = model.isEditing == false }
        }
    }

    // MARK: - Sections

    private var detailsSection: some View {
        Section {
            TextField("Title", text: $model.title)
                .focused($isTitleFocused)
            TextField("Notes", text: $model.notes, axis: .vertical)
                .lineLimit(3...6)
        } footer: {
            if let problem = model.errorMessage ?? model.validationProblem {
                Text(problem).foregroundStyle(.red)
            }
        }
    }

    private var datesSection: some View {
        Section {
            Toggle("All-day", isOn: Binding(
                get: { model.isAllDay },
                set: { model.setAllDay($0) }
            ))

            // Storyboard: the inline picker sits *below the field being
            // edited* and moves when focus moves — it is not two always-open
            // pickers, and not a modal sheet.
            dateRow(.starts, label: "Starts", day: $model.startDay, time: $model.startTime)
            dateRow(.ends, label: "Ends", day: $model.endDay, time: $model.endTime)
        } footer: {
            if model.isAllDay {
                // C25 stated where someone entering a stay will read it.
                Text("All-day events include the end date.")
            }
        }
    }

    @ViewBuilder
    private func dateRow(
        _ field: EventEditorViewModel.PickerField,
        label: String,
        day: Binding<String>,
        time: Binding<Date>
    ) -> some View {
        Button {
            model.openPicker = model.openPicker == field ? nil : field
        } label: {
            HStack {
                Text(label).foregroundStyle(.primary)
                Spacer()
                Text(model.dayLabel(day.wrappedValue))
                    .foregroundStyle(model.openPicker == field ? Color.accentColor : .secondary)
                if model.isAllDay == false {
                    Text(model.timeLabel(time.wrappedValue))
                        .foregroundStyle(model.openPicker == field ? Color.accentColor : .secondary)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)

        if model.openPicker == field {
            DatePicker(
                label,
                selection: dayBinding(day),
                displayedComponents: .date
            )
            .datePickerStyle(.graphical)
            .labelsHidden()

            // The time entry disappears entirely when all-day is on
            // (storyboard), rather than being disabled — a greyed field
            // invites the user to wonder what they did wrong.
            if model.isAllDay == false {
                DatePicker(label, selection: time, displayedComponents: .hourAndMinute)
                    .labelsHidden()
            }
        }
    }

    private var deleteSection: some View {
        Section {
            Button("Delete Event", role: .destructive) { isConfirmingDelete = true }
                .frame(maxWidth: .infinity)
        }
    }

    // MARK: - Bindings and labels

    /// Bridges the date-only string to `DatePicker`'s `Date`. Both
    /// conversions live on the ViewModel; this only wires the binding.
    private func dayBinding(_ day: Binding<String>) -> Binding<Date> {
        Binding(
            get: { model.date(forDay: day.wrappedValue) },
            set: { day.wrappedValue = model.dayString(from: $0) }
        )
    }

    // MARK: - Actions

    private func save() {
        Task {
            if let saved = await model.save() { onFinished(saved) }
        }
    }

    private func delete() {
        Task {
            guard let id = model.eventID else { return }
            if await model.delete() { onDeleted(id) }
        }
    }
}

#Preview("Create") {
    EventEditorView(
        mode: .create(dateOnly: "2026-07-17"), api: PreviewAPI(), onFinished: { _ in }
    )
}

#Preview("Edit") {
    EventEditorView(
        mode: .edit(CalendarEvent(
            id: "1", title: "Working on sauna construction",
            notes: "Materials arrive around 9:30.",
            startsAt: "2026-07-17T16:00:00.000Z", endsAt: "2026-07-17T17:00:00.000Z",
            isAllDay: false, createdBy: "preview-admin", creatorDisplayName: "Zach",
            createdAt: Date(), updatedAt: Date()
        )),
        api: PreviewAPI(),
        onFinished: { _ in }
    )
}
