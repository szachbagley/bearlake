//
//  EventEditorViewModelTests.swift
//  bearlake-clientTests
//

import Foundation
import Testing
@testable import bearlake_client

private let extremeZones = ["Pacific/Pago_Pago", "Pacific/Apia", "America/Denver", "UTC"]

private func cabin(_ zone: String) -> CabinDate {
    CabinDate(
        timeZone: TimeZone(identifier: zone) ?? .gmt,
        locale: Locale(identifier: "en_US")
    )
}

@MainActor
private func makeEditor(
    _ mode: EventEditorViewModel.Mode,
    zone: String = "America/Denver",
    api: FakeAPI = FakeAPI()
) -> (EventEditorViewModel, FakeAPI) {
    (EventEditorViewModel(mode: mode, api: api, dates: cabin(zone)), api)
}

/// Reads the encoded request body, so assertions are about the wire rather
/// than about intermediate state.
private func encodedBody(_ value: some Encodable) throws -> [String: Any] {
    let data = try APICoding.makeEncoder().encode(value)
    return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
}

// MARK: - All-day round-tripping (the priority area)

@MainActor
struct AllDayRoundTripTests {
    /// C22 at the editor boundary: an all-day event entered as a date must
    /// come back out as that same date, in every zone.
    @Test("an all-day event never shifts a day", arguments: extremeZones)
    func allDayNeverShifts(zone: String) async throws {
        let (editor, _) = makeEditor(.create(dateOnly: "2026-07-16"), zone: zone)
        editor.title = "Family stay"
        editor.setAllDay(true)
        editor.endDay = "2026-07-20"

        let composed = try #require(editor.composedDates)
        #expect(composed == .allDay(start: "2026-07-16", end: "2026-07-20"))

        let request = CreateEventRequest(title: "Family stay", notes: nil, dates: composed)
        let body = try encodedBody(request)
        #expect(body["startsAt"] as? String == "2026-07-16")
        #expect(body["endsAt"] as? String == "2026-07-20")
        #expect(body["isAllDay"] as? Bool == true)
    }

    /// C25 — a single-day all-day event has start == end, not end == start+1.
    @Test("a single-day all-day event has an inclusive end")
    func singleDayInclusive() async throws {
        let (editor, _) = makeEditor(.create(dateOnly: "2026-07-16"))
        editor.title = "Day trip"
        editor.setAllDay(true)

        #expect(editor.composedDates == .allDay(start: "2026-07-16", end: "2026-07-16"))
        #expect(editor.validationProblem == nil, "start == end is valid for all-day")
    }

    @Test("editing an existing all-day event pre-populates its literal dates")
    func editPrepopulatesAllDay() async throws {
        let event = CalendarEvent.fixture(
            title: "Stay", startsAt: "2026-07-16", endsAt: "2026-07-20", isAllDay: true
        )
        let (editor, _) = makeEditor(.edit(event), zone: "Pacific/Pago_Pago")
        #expect(editor.isAllDay)
        #expect(editor.startDay == "2026-07-16", "no shift at UTC-11")
        #expect(editor.endDay == "2026-07-20")
        #expect(editor.hasChanges == false)
    }
}

// MARK: - Timed serialization

@MainActor
struct TimedSerializationTests {
    @Test("a timed event serializes to the correct UTC instant")
    func timedSerializes() async throws {
        let (editor, _) = makeEditor(.create(dateOnly: "2026-07-17"))
        editor.title = "Sauna"
        editor.startTime = cabin("America/Denver").timeOfDay(hour: 10)
        editor.endTime = cabin("America/Denver").timeOfDay(hour: 11)

        guard case .timed(let start, let end)? = editor.composedDates else {
            Issue.record("expected a timed event")
            return
        }
        // 10:00 MDT is 16:00Z in July.
        #expect(APICoding.iso(from: start) == "2026-07-17T16:00:00.000Z")
        #expect(APICoding.iso(from: end) == "2026-07-17T17:00:00.000Z")
    }

    /// Both 2026 US transitions. A wall-clock hour has a different UTC offset
    /// either side, which is exactly what `Calendar` is for and what naive
    /// arithmetic gets wrong.
    @Test("timed events serialize correctly across both DST transitions")
    func dstTransitions() async throws {
        let denver = cabin("America/Denver")

        // Spring forward: Mar 8 2026. 10:00 MDT (UTC-6) → 16:00Z.
        let (spring, _) = makeEditor(.create(dateOnly: "2026-03-08"))
        spring.title = "After the change"
        spring.startTime = denver.timeOfDay(hour: 10)
        spring.endTime = denver.timeOfDay(hour: 11)
        guard case .timed(let springStart, _)? = spring.composedDates else {
            Issue.record("expected timed"); return
        }
        #expect(APICoding.iso(from: springStart) == "2026-03-08T16:00:00.000Z")

        // The day before, still MST (UTC-7) → 17:00Z for the same wall clock.
        let (before, _) = makeEditor(.create(dateOnly: "2026-03-07"))
        before.title = "Before the change"
        before.startTime = denver.timeOfDay(hour: 10)
        before.endTime = denver.timeOfDay(hour: 11)
        guard case .timed(let beforeStart, _)? = before.composedDates else {
            Issue.record("expected timed"); return
        }
        #expect(APICoding.iso(from: beforeStart) == "2026-03-07T17:00:00.000Z")

        // Fall back: Nov 1 2026. 10:00 MST (UTC-7) → 17:00Z.
        let (fall, _) = makeEditor(.create(dateOnly: "2026-11-01"))
        fall.title = "After falling back"
        fall.startTime = denver.timeOfDay(hour: 10)
        fall.endTime = denver.timeOfDay(hour: 11)
        guard case .timed(let fallStart, _)? = fall.composedDates else {
            Issue.record("expected timed"); return
        }
        #expect(APICoding.iso(from: fallStart) == "2026-11-01T17:00:00.000Z")

        // Oct 31, still MDT (UTC-6) → 16:00Z.
        let (dayBefore, _) = makeEditor(.create(dateOnly: "2026-10-31"))
        dayBefore.title = "Before falling back"
        dayBefore.startTime = denver.timeOfDay(hour: 10)
        dayBefore.endTime = denver.timeOfDay(hour: 11)
        guard case .timed(let octStart, _)? = dayBefore.composedDates else {
            Issue.record("expected timed"); return
        }
        #expect(APICoding.iso(from: octStart) == "2026-10-31T16:00:00.000Z")
    }

    /// The wall-clock hour 02:30 does not exist on a spring-forward morning.
    /// It must resolve to a real instant rather than nil.
    @Test("a nonexistent wall-clock time still resolves")
    func nonexistentWallClockTime() async throws {
        let denver = cabin("America/Denver")
        let instant = denver.instant(day: "2026-03-08", timeOfDay: denver.timeOfDay(hour: 2, minute: 30))
        #expect(instant != nil, "must not be nil — a picker can produce this")
    }

    @Test("an event spanning midnight keeps both days")
    func spansMidnight() async throws {
        let denver = cabin("America/Denver")
        let (editor, _) = makeEditor(.create(dateOnly: "2026-07-17"))
        editor.title = "Late games"
        editor.startTime = denver.timeOfDay(hour: 22)
        editor.endDay = "2026-07-18"
        editor.endTime = denver.timeOfDay(hour: 1)

        guard case .timed(let start, let end)? = editor.composedDates else {
            Issue.record("expected timed"); return
        }
        #expect(start < end)
        #expect(APICoding.iso(from: start) == "2026-07-18T04:00:00.000Z")
        #expect(APICoding.iso(from: end) == "2026-07-18T07:00:00.000Z")
    }
}

// MARK: - The all-day toggle (step 2, C24)

@MainActor
struct AllDayToggleTests {
    /// Mixing shapes is a server 400, so the toggle rewrites the held values
    /// rather than trusting whatever the fields contain.
    @Test("toggling on produces a date-only payload")
    func togglingOnRewritesShape() async throws {
        let (editor, _) = makeEditor(.create(dateOnly: "2026-07-17"))
        editor.title = "Thing"
        #expect(editor.composedDates?.isAllDay == false)

        editor.setAllDay(true)
        let composed = try #require(editor.composedDates)
        #expect(composed.isAllDay)
        #expect(composed.wireValues.startsAt == "2026-07-17")
        #expect(composed.wireValues.startsAt.contains("T") == false, "no instant leaked through")
    }

    @Test("toggling off produces an instant payload")
    func togglingOffRewritesShape() async throws {
        let (editor, _) = makeEditor(.create(dateOnly: "2026-07-17"))
        editor.title = "Thing"
        editor.setAllDay(true)
        editor.setAllDay(false)

        let composed = try #require(editor.composedDates)
        #expect(composed.isAllDay == false)
        #expect(composed.wireValues.startsAt.contains("T"), "must be an instant")
        #expect(editor.validationProblem == nil, "start must still precede end")
    }

    /// A timed event ending at exactly midnight belongs to the previous day.
    /// Carrying that end date forward would silently lengthen the stay.
    @Test("converting a midnight-ending event does not add a day")
    func midnightEndDoesNotAddADay() async throws {
        let denver = cabin("America/Denver")
        let (editor, _) = makeEditor(.create(dateOnly: "2026-07-17"))
        editor.title = "Evening"
        editor.startTime = denver.timeOfDay(hour: 18)
        editor.endDay = "2026-07-18"
        editor.endTime = denver.timeOfDay(hour: 0)

        editor.setAllDay(true)
        #expect(editor.endDay == "2026-07-17", "the event really ends on the 17th")
        #expect(editor.composedDates == .allDay(start: "2026-07-17", end: "2026-07-17"))
    }

    @Test("toggling twice returns to a valid timed event")
    func toggleIsStable() async throws {
        let (editor, _) = makeEditor(.create(dateOnly: "2026-07-17"))
        editor.title = "Thing"
        for _ in 0..<4 { editor.setAllDay(!editor.isAllDay) }
        #expect(editor.isAllDay == false)
        #expect(editor.validationProblem == nil)
    }

    @Test("toggling closes the inline picker")
    func toggleClosesPicker() async throws {
        let (editor, _) = makeEditor(.create(dateOnly: "2026-07-17"))
        editor.openPicker = .starts
        editor.setAllDay(true)
        #expect(editor.openPicker == nil)
    }
}

// MARK: - Validation (step 7)

@MainActor
struct EventValidationTests {
    @Test("a missing title blocks saving")
    func requiresTitle() async throws {
        let (editor, api) = makeEditor(.create(dateOnly: "2026-07-17"))
        #expect(editor.canSave == false)
        #expect(await editor.save() == nil)
        #expect(await api.callCount("createEvent") == 0, "no request for a known-bad value")
    }

    @Test("whitespace alone is not a title")
    func whitespaceIsNotATitle() async throws {
        let (editor, _) = makeEditor(.create(dateOnly: "2026-07-17"))
        editor.title = "   \n "
        #expect(editor.canSave == false)
    }

    @Test("an over-length title or notes blocks saving")
    func lengthCaps() async throws {
        let (editor, _) = makeEditor(.create(dateOnly: "2026-07-17"))
        editor.title = String(repeating: "a", count: Limits.eventTitleMax + 1)
        #expect(editor.canSave == false)

        editor.title = "Fine"
        editor.notes = String(repeating: "b", count: Limits.eventNotesMax + 1)
        #expect(editor.canSave == false)

        editor.notes = String(repeating: "b", count: Limits.eventNotesMax)
        #expect(editor.canSave, "exactly at the cap is allowed")
    }

    @Test("a timed event needs start strictly before end")
    func timedNeedsOrder() async throws {
        let denver = cabin("America/Denver")
        let (editor, api) = makeEditor(.create(dateOnly: "2026-07-17"))
        editor.title = "Backwards"
        editor.startTime = denver.timeOfDay(hour: 14)
        editor.endTime = denver.timeOfDay(hour: 9)
        #expect(editor.canSave == false)

        // Equal is also invalid — a zero-length event is not a thing.
        editor.endTime = denver.timeOfDay(hour: 14)
        #expect(editor.canSave == false)
        #expect(await editor.save() == nil)
        #expect(await api.callCount("createEvent") == 0)
    }

    /// All-day is inclusive, so start == end is a one-day event and valid —
    /// the opposite of the timed rule.
    @Test("an all-day event allows start equal to end but not after it")
    func allDayAllowsEqual() async throws {
        let (editor, _) = makeEditor(.create(dateOnly: "2026-07-17"))
        editor.title = "Stay"
        editor.setAllDay(true)
        #expect(editor.canSave)

        editor.endDay = "2026-07-16"
        #expect(editor.canSave == false, "end before start")
    }
}

// MARK: - Saving

@MainActor
struct EventSaveTests {
    @Test("creating sends the exact documented fields")
    func createSendsExactFields() async throws {
        let request = CreateEventRequest(
            title: "Stay", notes: nil, dates: .allDay(start: "2026-07-16", end: "2026-07-20")
        )
        let body = try encodedBody(request)
        #expect(Set(body.keys) == ["isAllDay", "title", "startsAt", "endsAt"])
    }

    @Test("creating with notes includes them")
    func createWithNotes() async throws {
        let request = CreateEventRequest(
            title: "Stay", notes: "Bring life jackets",
            dates: .allDay(start: "2026-07-16", end: "2026-07-16")
        )
        let body = try encodedBody(request)
        #expect(body["notes"] as? String == "Bring life jackets")
    }

    /// Clearing the notes must send an explicit null; omitting the key leaves
    /// the old text on the server.
    @Test("clearing the notes on an edit sends null, not nothing")
    func clearingNotesSendsNull() async throws {
        var patch = UpdateEventRequest()
        patch.title = "Same"
        patch.notes = .setNull
        patch.setDates(.allDay(start: "2026-07-16", end: "2026-07-16"))

        let body = try encodedBody(patch)
        #expect(body["notes"] is NSNull)
        #expect(body.keys.contains("notes"))
    }

    @Test("an edit sends the date fields together")
    func editSendsDatesTogether() async throws {
        var patch = UpdateEventRequest()
        patch.setDates(.timed(
            start: Date(timeIntervalSince1970: 1_784_311_200),
            end: Date(timeIntervalSince1970: 1_784_314_800)
        ))
        let body = try encodedBody(patch)
        #expect(Set(body.keys) == ["isAllDay", "startsAt", "endsAt"])
        #expect(body["isAllDay"] as? Bool == false)
    }

    @Test("saving a valid event reaches the API")
    func savingReachesAPI() async throws {
        let (editor, api) = makeEditor(.create(dateOnly: "2026-07-17"))
        editor.title = "Sauna"
        let saved = await editor.save()
        #expect(saved != nil)
        #expect(await api.callCount("createEvent") == 1)
    }

    @Test("a server failure surfaces its message and returns nothing")
    func serverFailureSurfaces() async throws {
        let (editor, api) = makeEditor(.create(dateOnly: "2026-07-17"))
        editor.title = "Sauna"
        await api.setNextError(APIError(
            status: 403, code: "FORBIDDEN", message: "Only the creator can change this event."
        ))
        #expect(await editor.save() == nil)
        #expect(editor.errorMessage == "Only the creator can change this event.")
    }
}

// MARK: - Mode and changes

@MainActor
struct EditorModeTests {
    @Test("a fresh create has no changes until something is typed")
    func createStartsClean() async throws {
        let (editor, _) = makeEditor(.create(dateOnly: "2026-07-17"))
        #expect(editor.hasChanges == false)
        editor.title = "Something"
        #expect(editor.hasChanges)
    }

    @Test("delete is only available in edit mode")
    func deleteOnlyWhenEditing() async throws {
        let (create, api) = makeEditor(.create(dateOnly: "2026-07-17"))
        #expect(create.isEditing == false)
        #expect(await create.delete() == false)
        #expect(await api.callCount("deleteEvent") == 0)
    }

    @Test("deleting in edit mode calls the API")
    func deleteInEditMode() async throws {
        let event = CalendarEvent.fixture(title: "Doomed")
        let api = FakeAPI()
        await api.seed(events: [event])
        let (editor, _) = makeEditor(.edit(event), api: api)

        #expect(editor.isEditing)
        #expect(await editor.delete())
        #expect(await api.callCount("deleteEvent") == 1)
    }

    @Test("a failed delete surfaces the server's message")
    func failedDeleteSurfaces() async throws {
        let event = CalendarEvent.fixture()
        let api = FakeAPI()
        await api.seed(events: [event])
        let (editor, _) = makeEditor(.edit(event), api: api)
        await api.setNextError(APIError(
            status: 403, code: "FORBIDDEN", message: "Only the creator can delete this event."
        ))
        #expect(await editor.delete() == false)
        #expect(editor.errorMessage == "Only the creator can delete this event.")
    }
}
