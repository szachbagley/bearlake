//
//  MonthGrid.swift
//  bearlake-client
//

import SwiftUI

/// The 6×7 month grid (storyboard): Sunday-start, today marked, the selected
/// day marked, and a dot on any day with something on it.
struct MonthGrid: View {
    let days: [CabinDate.GridDay]
    let selectedDay: String
    let today: String
    let hasEvents: (String) -> Bool
    let onSelect: (String) -> Void

    /// Sunday-start, matching `CabinDate`'s `firstWeekday = 1`.
    private let weekdaySymbols = ["S", "M", "T", "W", "T", "F", "S"]
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 7)

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 2) {
                ForEach(Array(weekdaySymbols.enumerated()), id: \.offset) { _, symbol in
                    Text(symbol)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                }
            }
            // The row of letters is decorative; VoiceOver reads each day's
            // full date from the cell itself.
            .accessibilityHidden(true)

            LazyVGrid(columns: columns, spacing: 2) {
                ForEach(days) { day in
                    DayCell(
                        day: day,
                        isSelected: day.dateOnly == selectedDay,
                        isToday: day.dateOnly == today,
                        hasEvents: hasEvents(day.dateOnly)
                    )
                    .onTapGesture { onSelect(day.dateOnly) }
                }
            }
        }
    }
}

private struct DayCell: View {
    let day: CabinDate.GridDay
    let isSelected: Bool
    let isToday: Bool
    let hasEvents: Bool

    /// The day number, read off the string rather than recomputed — the
    /// string is the identity (C22).
    private var dayNumber: String {
        let parts = day.dateOnly.split(separator: "-")
        guard parts.count == 3, let number = Int(parts[2]) else { return "" }
        return String(number)
    }

    var body: some View {
        VStack(spacing: 2) {
            Text(dayNumber)
                .font(.callout)
                .monospacedDigit()
                .foregroundStyle(numberColor)
                .frame(width: 30, height: 30)
                .background {
                    if isSelected {
                        Circle().fill(Color.accentColor)
                    } else if isToday {
                        Circle().strokeBorder(Color.accentColor, lineWidth: 1.5)
                    }
                }

            // A dot rather than a count: the day detail below is one tap
            // away, and a number here would crowd the cell at large Dynamic
            // Type sizes.
            Circle()
                .fill(hasEvents ? Color.secondary : Color.clear)
                .frame(width: 4, height: 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    private var numberColor: Color {
        if isSelected { return Color(.systemBackground) }
        return day.isInDisplayedMonth ? .primary : .secondary
    }

    /// Spoken as a real date rather than a bare number, since "17" alone
    /// means nothing out of context.
    private var accessibilityLabel: String {
        var label = day.dateOnly
        if let parts = day.dateOnly.split(separator: "-").last, let number = Int(parts) {
            label = "\(number)"
        }
        var traits: [String] = [label]
        if isToday { traits.append("today") }
        if hasEvents { traits.append("has events") }
        if day.isInDisplayedMonth == false { traits.append("outside this month") }
        return traits.joined(separator: ", ")
    }
}

#Preview {
    MonthGrid(
        days: CabinDate(timeZone: TimeZone(identifier: "America/Denver") ?? .current)
            .monthGrid(year: 2026, month: 7),
        selectedDay: "2026-07-17",
        today: "2026-07-17",
        hasEvents: { ["2026-07-16", "2026-07-17", "2026-07-18"].contains($0) },
        onSelect: { _ in }
    )
    .padding()
}
