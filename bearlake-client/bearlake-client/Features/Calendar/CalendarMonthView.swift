//
//  CalendarMonthView.swift
//  bearlake-client
//

import SwiftUI

/// The Calendar tab (storyboard): a year selector and month stepper, the
/// month grid, and the day detail below it.
struct CalendarMonthView: View {
    let auth: AuthViewModel
    @State private var model: CalendarViewModel

    init(auth: AuthViewModel, api: BearLakeAPI) {
        self.auth = auth
        _model = State(initialValue: CalendarViewModel(api: api))
    }

    /// A window of years around today. The cabin's calendar is not an archive
    /// — a handful either side covers planning next season and looking back
    /// at last one, without a picker the length of a phone.
    private var selectableYears: [Int] {
        let thisYear = model.dates.parts(ofDateOnly: model.todayDateOnly)?.year ?? 2026
        return Array((thisYear - 2)...(thisYear + 3))
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            MonthGrid(
                days: model.grid,
                selectedDay: model.selectedDay,
                today: model.todayDateOnly,
                hasEvents: model.hasEvents(on:),
                onSelect: model.selectDay
            )
            .padding(.horizontal, 8)

            Divider().padding(.top, 4)

            DayDetailView(
                model: model,
                onCreate: model.requestCreate(on:),
                onOpen: { model.requestOpen($0, as: auth.currentUser) }
            )
        }
        .navigationTitle("Calendar")
        .task { await model.loadIfNeeded() }
        // Month and year navigation change the window, so refetch when the
        // displayed month moves — not when only the selected day does.
        .task(id: "\(model.displayedYear)-\(model.displayedMonth)") {
            await model.loadIfNeeded()
        }
        .refreshable { await model.load() }
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

    private var header: some View {
        HStack {
            Button {
                model.stepMonth(by: -1)
            } label: {
                Image(systemName: "chevron.left")
            }
            .accessibilityLabel("Previous month")

            Text(model.monthLabel)
                .font(.headline)
                .frame(minWidth: 96)
                .accessibilityLabel("\(model.monthLabel) \(String(model.displayedYear))")

            Button {
                model.stepMonth(by: 1)
            } label: {
                Image(systemName: "chevron.right")
            }
            .accessibilityLabel("Next month")

            Spacer()

            Picker("Year", selection: Binding(
                get: { model.displayedYear },
                set: { model.showYear($0) }
            )) {
                ForEach(selectableYears, id: \.self) { year in
                    // verbatim: a year is not a quantity and must not be
                    // grouped as "2,026".
                    Text(verbatim: String(year)).tag(year)
                }
            }
            .pickerStyle(.menu)
            .accessibilityLabel("Year")

            if model.isLoading {
                ProgressView().padding(.leading, 4)
            }
        }
        .padding(.horizontal)
        .padding(.bottom, 4)
    }
}

#Preview {
    NavigationStack {
        CalendarMonthView(auth: .preview(), api: PreviewAPI())
    }
}
