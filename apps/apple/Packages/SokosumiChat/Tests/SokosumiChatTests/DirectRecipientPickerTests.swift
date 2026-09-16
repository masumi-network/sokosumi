import SokosumiChat
import Testing

@MainActor
struct DirectRecipientPickerTests {
  private let person = DirectRecipientTarget(id: .human("person"), name: "Person")
  private let coworker = DirectRecipientTarget(id: .coworker("coworker"), name: "AI")

  @Test func groupedRecipientsPutCoworkersFirstAndOmitEmptySections() async {
    let picker = DirectRecipientPicker(hasOrganization: true)
    let assistant = DirectRecipientTarget(id: .sokoBot("bot"), name: "Personal assistant")
    await picker.load { .init(targets: [person, assistant, coworker]) }
    #expect(picker.sections.map(\.id) == [.coworkers, .people, .assistant])
    #expect(picker.candidates.map(\.id) == [coworker.id, person.id, assistant.id])
    picker.query = "Person"
    #expect(picker.sections.map(\.id) == [.people, .assistant])
    picker.query = "no match"
    #expect(picker.sections.isEmpty)
    picker.query = ""
    picker.add(coworker)
    #expect(picker.sections.map(\.id) == [.people, .assistant])
    #expect(picker.selection.disabledReason(for: person.id) != nil)
    #expect(picker.selection.disabledReason(for: assistant.id) != nil)
    picker.remove(coworker.id)
    #expect(picker.sections.first?.targets == [coworker])
  }

  @Test func selectionAndRetryPreserveOnlyAvailableRecipients() async {
    let picker = DirectRecipientPicker(hasOrganization: true)
    await picker.load { .init(targets: [person, coworker]) }
    picker.add(person)
    #expect(picker.candidates == [coworker])
    picker.add(coworker)
    #expect(picker.selection.recipients == [person.id])
    #expect(await picker.create { _ in throw ChatServiceError.unexpectedResponse("Try again") } == false)
    #expect(picker.creationError == "Try again")
    #expect(picker.selection.recipients == [person.id])
    await picker.load { .init(targets: [coworker]) }
    #expect(picker.selection.recipients.isEmpty)
    picker.add(coworker)
    #expect(await picker.create { selection in selection.recipients == [coworker.id] })
  }

  @Test func rejectedCreationKeepsSelectionAndShowsRetryError() async {
    let picker = DirectRecipientPicker(hasOrganization: false)
    await picker.load { .init(targets: [coworker]) }
    picker.add(coworker)
    #expect(await picker.create { _ in false } == false)
    #expect(picker.creationError != nil)
    #expect(picker.selection.recipients == [coworker.id])
    #expect(await picker.create { _ in true })
    #expect(picker.creationError == nil)
  }

  @Test func latestRosterWinsAndCreateIsSingleFlight() async {
    let picker = DirectRecipientPicker(hasOrganization: false)
    var resumeLoad: CheckedContinuation<DirectRecipientRoster, Never>?
    let first = Task {
      await picker.load { await withCheckedContinuation { resumeLoad = $0 } }
    }
    while resumeLoad == nil {
      await Task.yield()
    }
    await picker.load { .init(targets: [coworker]) }
    resumeLoad?.resume(returning: .init(targets: [person]))
    await first.value
    #expect(picker.roster.targets == [coworker])
    picker.add(coworker)
    var resumeCreate: CheckedContinuation<Bool, Never>?
    let create = Task { await picker.create { _ in await withCheckedContinuation { resumeCreate = $0 } } }
    while resumeCreate == nil {
      await Task.yield()
    }
    #expect(picker.creating)
    #expect(await picker.create { _ in Issue.record("Duplicate request")
      return true
    } == false)
    picker.remove(coworker.id)
    #expect(picker.selection.recipients == [coworker.id])
    resumeCreate?.resume(returning: true)
    #expect(await create.value)
    #expect(!picker.creating)
  }
}
