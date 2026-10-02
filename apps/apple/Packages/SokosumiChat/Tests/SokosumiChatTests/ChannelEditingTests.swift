import CoreAPI
import Foundation
import SokosumiChat
import Testing

@MainActor
struct ChannelEditingTests {
  private func room(
    kind: Components.Schemas.ChatRoom.KindPayload = .channel,
    organizationId: String? = "org",
    access: Components.Schemas.ChatRoomAccess = .member,
    discoverability: Components.Schemas.ChatRoom.DiscoverabilityPayload? = ._private
  ) -> Components.Schemas.ChatRoom {
    .init(
      id: "room", organizationId: organizationId, name: "Team", slug: "team", kind: kind, isSelfDirect: false, isGroupDirect: false, topic: nil,
      discoverability: discoverability, createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast,
      unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .init(value1: access, value2: .init(stringLiteral: access.rawValue)),
      userMembers: [
        .init(id: "me", name: "Me", email: "me@example.com", presence: .online),
        .init(id: "guest", name: "Guest", email: "guest@example.com", presence: .offline, access: .guest),
        .init(id: "peer", name: "Peer", email: "peer@example.com", presence: .afk, access: .member)
      ],
      coworkerMembers: [.init(id: "agent", name: "Agent", slug: "agent", caption: nil, image: nil, presence: .online)],
      sokoBotMembers: [.init(id: "bot", name: "Assistant", caption: nil, ownerUserId: "me", presence: .offline),
                       .init(id: "peer-bot", name: "Peer's assistant", caption: nil, ownerUserId: "peer", presence: .online)]
    )
  }

  @Test func permissionsMatchCoreMembershipModule() {
    #expect(ChannelEditPermissions(room: room(), isOwnerOrAdmin: false) == .init(canEditMembers: true, canManageSettings: false))
    #expect(ChannelEditPermissions(room: room(), isOwnerOrAdmin: true) == .init(canEditMembers: true, canManageSettings: true))
    for blocked in [room(kind: .direct), room(organizationId: nil), room(access: .guest), room(discoverability: .matched)] {
      #expect(!ChannelEditPermissions.isEditable(blocked))
      #expect(ChannelEditPermissions(room: blocked, isOwnerOrAdmin: true) == .init(canEditMembers: false, canManageSettings: false))
    }
  }

  /// SOK-1258: Guests and Coworkers for any host member, host members for owners/admins only, a Soko Bot for its
  /// owner only, never yourself; guests and matched channels remove nobody.
  @Test func removalMatrixMatchesCore() {
    let channel = room()
    let member = ChannelEditPermissions(room: channel, isOwnerOrAdmin: false)
    let admin = ChannelEditPermissions(room: channel, isOwnerOrAdmin: true)
    func removable(_ permissions: ChannelEditPermissions) -> [DirectRecipient] {
      [.human("me"), .human("guest"), .human("peer"), .human("absent"), .coworker("agent"), .coworker("absent"), .sokoBot("bot"), .sokoBot("peer-bot")]
        .filter { permissions.canRemove($0, in: channel, currentUserId: "me") }
    }
    #expect(removable(member) == [.human("guest"), .coworker("agent"), .sokoBot("bot")])
    #expect(removable(admin) == [.human("guest"), .human("peer"), .coworker("agent"), .sokoBot("bot")])
    for blocked in [room(access: .guest), room(discoverability: .matched)] {
      let permissions = ChannelEditPermissions(room: blocked, isOwnerOrAdmin: true)
      #expect(!permissions.canRemove(.human("guest"), in: blocked, currentUserId: "me"))
      #expect(!permissions.canRemove(.coworker("agent"), in: blocked, currentUserId: "me"))
      #expect(!permissions.canRemove(.sokoBot("bot"), in: blocked, currentUserId: "me"))
    }
  }

  @Test func draftSeedsSettingsFromRoom() {
    var draft = ChannelEditDraft(room: room())
    #expect(draft.name == "Team")
    #expect(draft.topic.isEmpty)
    #expect(draft.visibility == .private)
    #expect(ChannelEditDraft(room: room(discoverability: nil)).visibility == .public)
    draft.setName(String(repeating: "👩🏽", count: 80))
    #expect(draft.name.utf16.count <= 80)
    draft.setTopic(String(repeating: "x", count: 210))
    #expect(draft.topic.count == 200)
    draft.setName("  ")
    #expect(!draft.isValid)
  }

  /// The settings PATCH no longer carries a roster; membership moved to the members endpoints.
  @Test func updateRequestSendsSettingsWithoutRoster() throws {
    var draft = ChannelEditDraft(room: room())
    draft.setName(" Renamed ")
    draft.setTopic("  Plans  ")
    draft.visibility = .external
    let encoded = try JSONEncoder().encode(draft.updateRequest)
    let body = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
    #expect(Set(body.keys) == ["name", "topic", "discoverability"])
    #expect(body["name"] as? String == "Renamed")
    #expect(body["topic"] as? String == "Plans")
    #expect(body["discoverability"] as? String == "external")
  }

  @Test func saveIsSingleFlightAndPreservesDraftOnFailure() async {
    let model = ChannelEditing(room: room())
    model.draft.setName("Renamed")
    let draft = model.draft
    let failed = await model.save { _ in
      #expect(model.saving)
      let duplicate = await model.save { _ in
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
    let refused = await model.save { _ in false }
    #expect(!refused)
    #expect(model.errorMessage == "Couldn’t update the channel. Try again.")
    let saved = await model.save { submitted in
      #expect(submitted == draft)
      return true
    }
    #expect(saved)
    #expect(model.errorMessage == nil)
  }

  @Test func roomUpdateKeepsTheDraftAndGuestAccessStopsSave() {
    var currentRoom = room()
    let model = ChannelEditing(room: currentRoom)
    model.draft.setName("Renamed")
    currentRoom.unreadCount = 3
    model.updateRoom(currentRoom)
    #expect(model.draft.name == "Renamed")
    #expect(model.canSave)
    currentRoom.myAccess = .init(value1: .guest, value2: "guest")
    model.updateRoom(currentRoom)
    #expect(!model.canSave)
  }
}
