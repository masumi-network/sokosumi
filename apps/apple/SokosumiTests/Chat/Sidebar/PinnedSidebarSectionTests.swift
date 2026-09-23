#if os(macOS)
  import CoreAPI
  import Foundation
  import SokosumiChat
  import SokosumiWorkspace
  import Testing

  @MainActor struct PinnedSidebarSectionTests {
    private func room(
      _ id: String, _ name: String, kind: Components.Schemas.ChatRoom.KindPayload = .channel,
      discoverability: Components.Schemas.ChatRoom.DiscoverabilityPayload? = ._public, starredAfter seconds: TimeInterval? = nil,
      unread: Int = 0, mentions: Int = 0, peers: [Components.Schemas.ChatRoomUserParticipant] = []
    ) -> Components.Schemas.ChatRoom {
      .init(
        id: id, name: name, kind: kind, isSelfDirect: false, isGroupDirect: false, discoverability: kind == .channel ? discoverability : nil,
        createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast, unreadCount: unread, unreadMentionCount: mentions,
        starredAt: seconds.map { Date(timeIntervalSince1970: $0) }, markedUnread: false, myAccess: .member, userMembers: peers, coworkerMembers: [], sokoBotMembers: []
      )
    }

    @Test func pinnedSectionPartitionsAndEntersReorder() {
      let state = WorkspaceState()
      let ada = Components.Schemas.ChatRoomUserParticipant(id: "ada", name: "Ada Lovelace", email: "ada@example.com", presence: .online)
      state.rooms = [
        room("private", "design-reviews", discoverability: ._private, starredAfter: 10, unread: 2),
        room("direct", "Ada", kind: .direct, starredAfter: 20, peers: [ada]),
        room("external", "Acme partners", discoverability: .external, starredAfter: 30, unread: 1, mentions: 3),
        room("long", "quarterly-roadmap-planning-and-very-long-launch-review", starredAfter: 40),
        room("plain", "Grace", kind: .direct, peers: [.init(id: "grace", name: "Grace Hopper", email: "grace@example.com", presence: .offline)])
      ]
      state.selectedRoomId = "direct"
      #expect(state.sidebar.partitioned.pinned.map(\.id) == ["private", "direct", "external", "long"])
      state.sidebar.setPinnedReorderMode(true)
      #expect(state.sidebar.pinnedReorderMode)
    }
  }
#endif
