//
//  DayDetailView.swift
//  bearlake-client
//

import SwiftUI

/// The day detail below the grid (storyboard): a `< July 17, 2026 >` header
/// with `+`, all-day and multi-day events pinned at the top, then an
/// hour-by-hour column for timed events.
struct DayDetailView: View {
    let model: CalendarViewModel
    /// Tapping empty space in the column creates an event on this day
    /// (Phase 6 supplies the editor).
    var onCreate: (String) -> Void = { _ in }
    var onOpen: (CalendarEvent) -> Void = { _ in }

    private var dayEvents: [CalendarEvent] { model.events(on: model.selectedDay) }
    private var pinned: [CalendarEvent] { dayEvents.filter { model.isPinned($0) } }
    private var timed: [CalendarEvent] { dayEvents.filter { model.isPinned($0) == false } }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()

            if pinned.isEmpty == false {
                pinnedSection
                Divider()
            }

            hourColumn
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Button {
                model.stepSelectedDay(by: -1)
            } label: {
                Image(systemName: "chevron.left")
            }
            .accessibilityLabel("Previous day")

            Spacer()
            Text(model.selectedDayLabel)
                .font(.headline)
            Spacer()

            Button {
                model.stepSelectedDay(by: 1)
            } label: {
                Image(systemName: "chevron.right")
            }
            .accessibilityLabel("Next day")

            Button {
                onCreate(model.selectedDay)
            } label: {
                Image(systemName: "plus")
            }
            .accessibilityLabel("New event")
            .padding(.leading, 8)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    // MARK: - Pinned

    /// All-day and multi-day events sit above the column: they have no single
    /// hour, and burying a week-long stay inside an hour row would hide the
    /// most important thing on the day.
    private var pinnedSection: some View {
        VStack(spacing: 0) {
            ForEach(pinned) { event in
                Button {
                    onOpen(event)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(event.title)
                            .foregroundStyle(.primary)
                        Text(model.rangeLabel(for: event))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal)
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
            }
        }
        .padding(.vertical, 4)
    }

    // MARK: - Hour column

    /// Deliberately not its own `ScrollView` — the page provides one. Nesting
    /// two on the same axis put this column's scrollable area under the
    /// floating tab bar, so swiping in it switched tabs.
    private var hourColumn: some View {
        LazyVStack(spacing: 0) {
            ForEach(0..<24, id: \.self) { hour in
                HourRow(
                    hour: hour,
                    label: model.hourLabel(hour),
                    events: timed.filter { model.hourRow(for: $0) == hour },
                    onCreate: { onCreate(model.selectedDay) },
                    onOpen: onOpen
                )
            }
        }
    }

}

private struct HourRow: View {
    let hour: Int
    let label: String
    let events: [CalendarEvent]
    let onCreate: () -> Void
    let onOpen: (CalendarEvent) -> Void

    /// The time gutter has to grow with the text. At a fixed width the label
    /// wrapped mid-word at accessibility sizes — "1 A / M" — which is worse
    /// than a wider gutter.
    @ScaledMetric(relativeTo: .caption2) private var gutterWidth: CGFloat = 52

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text(label)
                .font(.caption2)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .frame(width: gutterWidth, alignment: .trailing)
                // The label is only meaningful next to an event; an empty
                // row would otherwise make VoiceOver read all 24 hours.
                .accessibilityHidden(events.isEmpty)

            VStack(alignment: .leading, spacing: 2) {
                if events.isEmpty {
                    // Tapping empty space creates an event on this day
                    // (storyboard).
                    Color.clear
                        .frame(height: 28)
                        .contentShape(Rectangle())
                        .onTapGesture(perform: onCreate)
                } else {
                    ForEach(events) { event in
                        Button {
                            onOpen(event)
                        } label: {
                            Text(event.title)
                                .font(.callout)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 4)
                                .padding(.horizontal, 6)
                                .background(Color.accentColor.opacity(0.15))
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(event.title), \(label)")
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal)
        .overlay(alignment: .top) {
            Divider().padding(.leading, gutterWidth + 8)
        }
    }
}

#Preview {
    DayDetailView(model: CalendarViewModel(api: PreviewAPI()))
}
