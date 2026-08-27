//
//  EventDetailView.swift
//  bearlake-client
//

import SwiftUI

/// Read-only event view (storyboard §8.5): title, formatted range, notes.
///
/// Reached when the viewer is neither an admin nor the event's creator. The
/// edit control is absent rather than disabled — offering a button that
/// answers 403 is worse than not offering it. This is an affordance, not the
/// boundary; the server refuses the write regardless (C48).
struct EventDetailView: View {
    let event: CalendarEvent
    let rangeLabel: String
    /// Non-nil only when the viewer may edit.
    var onEdit: (@MainActor () -> Void)?
    /// Dismisses the sheet.
    ///
    /// Required, not optional: with `onEdit` nil this screen previously had
    /// no button at all and relied on swipe-to-dismiss. That is not
    /// discoverable for an audience of varying technical ability, and Phase
    /// 10 made it the path *everyone* takes offline rather than only members
    /// viewing someone else's event.
    var onClose: @MainActor () -> Void = {}

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(event.title)
                            .font(.title3)
                        Text(rangeLabel)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                    .accessibilityElement(children: .combine)
                }

                if let notes = event.notes, notes.isEmpty == false {
                    Section("Notes") {
                        Text(notes)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Section {
                    LabeledContent("Added by", value: event.creatorDisplayName)
                }
            }
            .navigationTitle("Event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done", action: onClose)
                }
                if let onEdit {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(action: onEdit) {
                            Image(systemName: "square.and.pencil")
                        }
                        .accessibilityLabel("Edit event")
                    }
                }
            }
        }
    }
}

// Previews are DEBUG-only: the `#Preview` macro's generated code compiles in
// every configuration, and it references `PreviewAPI` / `.preview()`, which
// live behind `#if DEBUG` in PreviewSupport.swift so no test double ever
// reaches a shipping binary. Without this guard the Release build does not
// compile — which is how it stayed broken until Phase 11 built it.
#if DEBUG
#Preview("Read-only") {
    EventDetailView(
        event: CalendarEvent(
            id: "1", title: "Working on sauna construction",
            notes: "Materials will arrive from Amazon around 9:30; probably won't finish it all today.",
            startsAt: "2026-07-17T16:00:00.000Z", endsAt: "2026-07-17T17:00:00.000Z",
            isAllDay: false, createdBy: "someone-else", creatorDisplayName: "Rachel",
            createdAt: Date(), updatedAt: Date()
        ),
        rangeLabel: "Jul 17, 2026, 10:00 AM – 11:00 AM"
    )
}

#Preview("Editable") {
    EventDetailView(
        event: CalendarEvent(
            id: "1", title: "Family stay", notes: nil,
            startsAt: "2026-07-16", endsAt: "2026-07-20", isAllDay: true,
            createdBy: "preview-admin", creatorDisplayName: "Zach",
            createdAt: Date(), updatedAt: Date()
        ),
        rangeLabel: "Jul 16, 2026 – Jul 20, 2026",
        onEdit: {}
    )
}
#endif
