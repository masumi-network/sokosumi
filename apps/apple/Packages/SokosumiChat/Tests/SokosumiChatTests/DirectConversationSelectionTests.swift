@testable import SokosumiChat
import Testing

struct DirectConversationSelectionTests {
  @Test func humanGroupsRequireOrganizationAndExcludeAI() {
    var selection = DirectConversationSelection(hasOrganization: true, currentUserId: "me")
    selection.add(.human("alice"))
    selection.add(.human("bob"))
    selection.add(.human("alice"))
    selection.add(.coworker("helper"))
    selection.add(.sokoBot("assistant"))
    #expect(selection.recipients == [.human("alice"), .human("bob")])
    #expect(selection.disabledReason(for: .coworker("helper")) != nil)

    var personal = DirectConversationSelection(hasOrganization: false, currentUserId: "me")
    personal.add(.human("alice"))
    personal.add(.human("bob"))
    #expect(personal.recipients == [.human("alice")])
    personal.remove(.human("alice"))
    personal.add(.human("bob"))
    #expect(personal.recipients == [.human("bob")])
  }

  @Test func selectingAIReplacesOnlyTheSameKind() {
    var selection = DirectConversationSelection(hasOrganization: true, currentUserId: "me")
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

  /// Web `isTargetDisabled` (`create-direct-dialog.tsx`:111-138): Message yourself takes no one else, and is
  /// itself unavailable once anyone else is chosen. It needs no organization.
  @Test(arguments: [false, true])
  func messageYourselfIsExclusive(hasOrganization: Bool) {
    let exclusive = "Self-chat cannot include other recipients."
    var selection = DirectConversationSelection(hasOrganization: hasOrganization, currentUserId: "me")
    #expect(selection.disabledReason(for: .human("me")) == nil)
    selection.add(.human("me"))
    #expect(selection.recipients == [.human("me")])
    #expect(selection.isSelfDirect)
    for other in [DirectRecipient.human("ada"), .coworker("helper"), .sokoBot("bot")] {
      #expect(selection.disabledReason(for: other) == exclusive)
      selection.add(other)
    }
    #expect(selection.recipients == [.human("me")])
    selection.remove(.human("me"))
    #expect(!selection.isSelfDirect)

    for first in [DirectRecipient.human("ada"), .coworker("helper"), .sokoBot("bot")] {
      var other = DirectConversationSelection(hasOrganization: hasOrganization, currentUserId: "me")
      other.add(first)
      #expect(other.disabledReason(for: .human("me")) == exclusive)
      other.add(.human("me"))
      #expect(other.recipients == [first])
      #expect(!other.isSelfDirect)
    }
  }
}
