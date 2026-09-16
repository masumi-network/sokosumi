@testable import SokosumiChat
import Testing

struct DirectConversationSelectionTests {
  @Test func humanGroupsRequireOrganizationAndExcludeAI() {
    var selection = DirectConversationSelection(hasOrganization: true)
    selection.add(.human("alice"))
    selection.add(.human("bob"))
    selection.add(.human("alice"))
    selection.add(.coworker("helper"))
    selection.add(.sokoBot("assistant"))
    #expect(selection.recipients == [.human("alice"), .human("bob")])
    #expect(selection.disabledReason(for: .coworker("helper")) != nil)

    var personal = DirectConversationSelection(hasOrganization: false)
    personal.add(.human("alice"))
    personal.add(.human("bob"))
    #expect(personal.recipients == [.human("alice")])
    personal.remove(.human("alice"))
    personal.add(.human("bob"))
    #expect(personal.recipients == [.human("bob")])
  }

  @Test func selectingAIReplacesOnlyTheSameKind() {
    var selection = DirectConversationSelection(hasOrganization: true)
    selection.add(.coworker("first"))
    selection.add(.coworker("second"))
    selection.add(.human("alice"))
    selection.add(.sokoBot("assistant"))
    #expect(selection.recipients == [.coworker("second")])
    selection.remove(.coworker("second"))
    selection.add(.sokoBot("first"))
    selection.add(.sokoBot("second"))
    selection.add(.coworker("helper"))
    #expect(selection.recipients == [.sokoBot("second")])
  }
}
