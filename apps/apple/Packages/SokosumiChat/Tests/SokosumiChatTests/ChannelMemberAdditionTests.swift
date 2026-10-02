import CoreAPI
import Foundation
import SokosumiChat
import Testing

@MainActor
struct ChannelMemberAdditionTests {
  private let roster = ChatRecipientRoster(targets: [
    .init(id: .human("me"), name: "Me"), .init(id: .human("peer"), name: "Peer"), .init(id: .human("guest"), name: "Guest"),
    .init(id: .human("new"), name: "Newcomer"), .init(id: .coworker("agent"), name: "Agent"), .init(id: .coworker("writer"), name: "Writer"),
    .init(id: .sokoBot("bot"), name: "Assistant")
  ])

  private func room(access: Components.Schemas.ChatRoomAccess = .member) -> Components.Schemas.ChatRoom {
    .init(
      id: "room", organizationId: "org", name: "Partners", slug: "partners", kind: .channel, isSelfDirect: false, isGroupDirect: false,
      discoverability: .external, createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast,
      unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .init(value1: access, value2: .init(stringLiteral: access.rawValue)),
      userMembers: [.init(id: "me", name: "Me", email: "me@example.com", presence: .online),
                    .init(id: "peer", name: "Peer", email: "peer@example.com", presence: .online),
                    .init(id: "guest", name: "Guest", email: "guest@example.com", presence: .offline, access: .guest)],
      coworkerMembers: [.init(id: "agent", name: "Agent", slug: "agent", presence: .online)],
      sokoBotMembers: []
    )
  }

  /// Web's Add picker lists only non-members: people, Coworkers and the caller's own assistant, in that order.
  @Test func listsOnlyNonMembersAndAddsTheSelection() async {
    let model = ChannelMemberAddition(room: room())
    #expect(!model.canAdd)
    await model.load { roster }
    #expect(model.sections.map(\.id) == [.people, .coworkers, .assistant])
    #expect(model.sections.flatMap(\.targets).map(\.id) == [.human("new"), .coworker("writer"), .sokoBot("bot")])
    #expect(!model.canAdd, "Nothing selected yet")
    model.selection = [.human("new"), .sokoBot("bot")]
    var submitted: [Set<DirectRecipient>] = []
    let added = await model.add { selection in
      submitted.append(selection)
      #expect(model.adding)
      let duplicate = await model.add { _ in
        Issue.record("Duplicate add")
        return true
      }
      #expect(!duplicate)
      return true
    }
    #expect(added && submitted == [[.human("new"), .sokoBot("bot")]])
    #expect(model.selection.isEmpty && !model.adding && model.errorMessage == nil)
  }

  @Test func failuresKeepTheSelectionAndSurfaceCoreCopy() async {
    let model = ChannelMemberAddition(room: room())
    await model.load { roster }
    model.selection = [.coworker("writer")]
    let refused = await model.add { _ in false }
    #expect(!refused && model.errorMessage == "Couldn’t add members. Try again.")
    let failed = await model.add { _ in throw ChatServiceError.unprocessable(statusCode: 403, message: "Guests cannot manage channel members.") }
    #expect(!failed && model.errorMessage == "Guests cannot manage channel members.")
    #expect(model.selection == [.coworker("writer")])
  }

  /// A member page failure hides only People; a failed roster blocks Add until Retry.
  @Test func loadFailuresFollowParticipantCheckboxes() async {
    let model = ChannelMemberAddition(room: room())
    await model.load { .init(targets: [.init(id: .coworker("writer"), name: "Writer")], membersLoadFailed: true) }
    #expect(model.membersLoadFailed && model.sections.map(\.id) == [.coworkers])
    await model.load { throw URLError(.notConnectedToInternet) }
    #expect(model.roster == nil && model.errorMessage == "No network connection. Check your connection and try again.")
    model.selection = [.coworker("writer")]
    #expect(!model.canAdd)
  }

  /// Someone added from another window leaves the list and the selection; a guest viewer can never add.
  @Test func roomUpdatesDropNewMembersAndGuestsCannotAdd() async {
    var current = room()
    let model = ChannelMemberAddition(room: current)
    await model.load { roster }
    model.selection = [.human("new"), .coworker("writer")]
    current.coworkerMembers.append(.init(id: "writer", name: "Writer", slug: "writer", presence: .online))
    model.updateRoom(current)
    #expect(model.selection == [.human("new")])
    #expect(model.sections.flatMap(\.targets).map(\.id) == [.human("new"), .sokoBot("bot")])
    #expect(model.canAdd)
    model.updateRoom(room(access: .guest))
    #expect(!model.canAdd)
  }
}
