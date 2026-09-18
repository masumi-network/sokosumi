import CoreAPI
import Foundation
import SokosumiChat
import Testing

@MainActor
struct ChannelEditingTests {
  private let roster = ChatRecipientRoster(targets: [
    .init(id: .human("me"), name: "Me"), .init(id: .human("peer"), name: "Peer"),
    .init(id: .coworker("agent"), name: "Agent"), .init(id: .sokoBot("bot"), name: "Assistant")
  ])

  private func room(
    kind: Components.Schemas.ChatRoom.KindPayload = .channel,
    organizationId: String? = "org",
    access: Components.Schemas.ChatRoomAccess = .member,
    discoverability: Components.Schemas.ChatRoom.DiscoverabilityPayload? = ._private
  ) throws -> Components.Schemas.ChatRoom {
    try .init(
      id: "room", organizationId: organizationId, name: "Team", slug: "team", kind: kind, isSelfDirect: false, topic: nil,
      discoverability: discoverability, createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast,
      unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: access,
      userMembers: [
        .init(id: "me", name: "Me", email: "me@example.com", presence: .online),
        .init(id: "guest", name: "Guest", email: "guest@example.com", presence: .offline, access: .init(value1: .guest, value2: .init(unvalidatedValue: "guest"))),
        .init(id: "peer", name: "Peer", email: "peer@example.com", presence: .afk, access: .init(value1: .member, value2: .init(unvalidatedValue: "member")))
      ],
      coworkerMembers: [.init(id: "agent", name: "Agent", slug: "agent", caption: nil, image: nil, presence: .online)],
      sokoBotMembers: [.init(id: "bot", name: "Assistant", caption: nil, presence: .offline)]
    )
  }

  @Test func permissionsMatchWebRoomsClient() throws {
    #expect(try ChannelEditPermissions(room: room(), isOwnerOrAdmin: false) == .init(canEditMembers: true, canManageSettings: false))
    #expect(try ChannelEditPermissions(room: room(), isOwnerOrAdmin: true) == .init(canEditMembers: true, canManageSettings: true))
    for blocked in try [room(kind: .direct), room(organizationId: nil), room(access: .guest), room(discoverability: .matched)] {
      #expect(!ChannelEditPermissions.isEditable(blocked))
      #expect(ChannelEditPermissions(room: blocked, isOwnerOrAdmin: true) == .init(canEditMembers: false, canManageSettings: false))
    }
  }

  @Test func draftSeedsFromRoomWithoutGuests() throws {
    var draft = try ChannelEditDraft(room: room())
    #expect(draft.name == "Team")
    #expect(draft.topic.isEmpty)
    #expect(draft.visibility == .private)
    #expect(draft.recipients == [.human("me"), .human("peer"), .coworker("agent"), .sokoBot("bot")])
    #expect(try ChannelEditDraft(room: room(discoverability: nil)).visibility == .public)
    draft.setName(String(repeating: "👩🏽", count: 80))
    #expect(draft.name.utf16.count <= 80)
    draft.setTopic(String(repeating: "x", count: 210))
    #expect(draft.topic.count == 200)
    draft.setName("  ")
    #expect(!draft.isValid)
  }

  @Test func saveNeedsLoadedRosterAndPreservesDraftOnFailure() async throws {
    let model = try ChannelEditing(room: room())
    let early = await model.save { _, _ in
      Issue.record("Saved before loading")
      return true
    }
    #expect(!early)
    await model.load { throw URLError(.notConnectedToInternet) }
    #expect(model.errorMessage == "No network connection. Check your connection and try again.")
    #expect(!model.canSave)
    await model.load { .init(recipients: roster, isOwnerOrAdmin: false) }
    #expect(model.errorMessage == nil)
    #expect(model.permissions == .init(canEditMembers: true, canManageSettings: false))
    model.draft.recipients.remove(.coworker("agent"))
    let draft = model.draft
    let failed = await model.save { _, _ in
      #expect(model.saving)
      let duplicate = await model.save { _, _ in
        Issue.record("Duplicate save")
        return true
      }
      #expect(!duplicate)
      throw ChatServiceError.unprocessable(statusCode: 403, message: "Only an organization owner or admin can update channel settings.")
    }
    #expect(!failed)
    #expect(!model.saving)
    #expect(model.draft == draft)
    #expect(model.errorMessage == "Only an organization owner or admin can update channel settings.")
    let saved = await model.save { submitted, permissions in
      #expect(submitted == draft)
      #expect(permissions.canManageSettings == false)
      return true
    }
    #expect(saved)
    #expect(model.errorMessage == nil)
  }

  @Test func membersLoadFailureBlocksSave() async throws {
    let model = try ChannelEditing(room: room())
    await model.load { .init(recipients: .init(targets: [], membersLoadFailed: true), isOwnerOrAdmin: true) }
    #expect(!model.canSave)
    await model.load { .init(recipients: roster, isOwnerOrAdmin: true) }
    #expect(model.canSave)
    #expect(model.sections.map(\.id) == [.people, .coworkers, .assistant])
  }
}
