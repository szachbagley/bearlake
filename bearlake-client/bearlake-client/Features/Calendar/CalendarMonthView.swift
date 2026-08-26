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

    private let api: BearLakeAPI

    init(auth: AuthViewModel, api: BearLakeAPI, cache: CacheStore?) {
        self.auth = auth
        self.api = api
        _model = State(initialValue: CalendarViewModel(api: api, cache: cache))
    }

    /// A window of years around today. The cabin's calendar is not an archive
    /// — a handful either side covers planning next season and looking back
    /// at last one, without a picker the length of a phone.
    private var selectableYears: [Int] {
        let thisYear = model.dates.parts(ofDateOnly: model.todayDateOnly)?.year ?? 2026
        return Array((thisYear - 2)...(thisYear + 3))
    }

    var body: some View {
        // One scroll view for the whole screen.
        //
        // The day detail used to have its own, nested inside this VStack.
        // On a phone the grid takes most of the height, which left the hour
        // column a ~150pt strip whose scrollable area ran under the floating
        // tab bar — a swipe near the bottom switched tabs instead of
        // scrolling. Two scroll views on the same axis is the wrong shape
        // here; the grid scrolling away is fine and expected.
        ScrollView {
            VStack(spacing: 0) {
                if model.isOffline {
                    OfflineBanner().padding(.horizontal)
                }
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
        }
        .navigationTitle("Calendar")
        .task { await model.loadIfNeeded() }
        // Month and year navigation change the window, so refetch when the
        // displayed month moves — not when only the selected day does.
        .task(id: "\(model.displayedYear)-\(model.displayedMonth)") {
            await model.loadIfNeeded()
        }
        .refreshable { await model.load() }
        // One sheet driven by the DayAction the ViewModel produced in
        // Phase 5, so this view never re-decides who may edit what.
        .sheet(item: Binding(
            get: { model.pendingAction },
            set: { model.pendingAction = $0 }
        )) { action in
            editorSheet(for: action)
        }
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

    @ViewBuilder
    private func editorSheet(for action: CalendarViewModel.DayAction) -> some View {
        switch action {
        case .create(let dateOnly):
            EventEditorView(
                mode: .create(dateOnly: dateOnly),
                api: api,
                dates: model.dates,
                onFinished: { saved in
                    model.pendingAction = nil
                    if saved != nil { Task { await model.load() } }
                }
            )
        case .edit(let event):
            EventEditorView(
                mode: .edit(event),
                api: api,
                dates: model.dates,
                onFinished: { saved in
                    model.pendingAction = nil
                    if saved != nil { Task { await model.load() } }
                },
                onDeleted: { _ in
                    model.pendingAction = nil
                    Task { await model.load() }
                }
            )
        case .view(let event):
            EventDetailView(
                event: event,
                rangeLabel: model.rangeLabel(for: event),
                onClose: { model.pendingAction = nil }
            )
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
                .lineLimit(1)
                // No fixed minWidth: at accessibility sizes a reserved width
                // pushed the year picker into the weekday header.
                .minimumScaleFactor(0.7)
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
            .lineLimit(1)
            .fixedSize()
            // No .accessibilityLabel here: Picker("Year", …) already supplies
            // one, and adding a second makes VoiceOver read "Year, Year".

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
        CalendarMonthView(auth: .preview(), api: PreviewAPI(), cache: nil)
    }
}
