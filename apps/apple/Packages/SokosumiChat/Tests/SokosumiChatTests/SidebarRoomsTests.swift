import CoreAPI
import Foundation
import SokosumiChat
import Testing

private let baseDate = Date(timeIntervalSince1970: 1_700_000_000)

private func makePeer(id: String, name: String) -> Components.Schemas.ChatRoomUserParticipant {
  .init(id: id, name: name, email: "\(id)@example.com", presence: .online)
}

private func makeRoom(
  id: String,
  name: String,
  kind: Components.Schemas.ChatRoom.KindPayload = .channel,
  discoverability: Components.Schemas.ChatRoom.DiscoverabilityPayload? = ._public,
  myAccess: Components.Schemas.ChatRoomAccess = .member,
  unreadCount: Int = 0,
  unreadMentionCount: Int = 0,
  markedUnread: Bool = false,
  starredAt: Date? = nil,
  mutedAt: Date? = nil,
  updatedAt: Date = baseDate,
  peers: [Components.Schemas.ChatRoomUserParticipant] = []
) -> Components.Schemas.ChatRoom {
  .init(
    id: id,
    name: name,
    kind: kind,
    discoverability: kind == .channel ? discoverability : nil,
    createdByUserId: "user_1",
    createdAt: baseDate,
    updatedAt: updatedAt,
    unreadCount: unreadCount,
    unreadMentionCount: unreadMentionCount,
    starredAt: starredAt,
    mutedAt: mutedAt,
    markedUnread: markedUnread,
    myAccess: myAccess,
    userMembers: peers,
    coworkerMembers: [],
    sokoBotMembers: []
  )
}

struct SidebarRoomsTests {
  @Test func partitionsChannelsDirectsAndExternal() {
    let rooms = [
      makeRoom(id: "c1", name: "general"),
      makeRoom(id: "d1", name: "Ada", kind: .direct),
      makeRoom(id: "e1", name: "partner", discoverability: .external),
      makeRoom(id: "m1", name: "matched", discoverability: .matched),
      makeRoom(id: "g1", name: "guest-room", myAccess: .guest),
      // Guest access always reads as External (checked before kind,
      // mirroring web), even for a Direct.
      makeRoom(id: "d2", name: "Guest Peer", kind: .direct, myAccess: .guest),
    ]
    let partitioned = partitionRoomsForSidebar(rooms)
    #expect(partitioned.channels.map(\.id) == ["c1"])
    #expect(partitioned.directMessages.map(\.id) == ["d1"])
    #expect(Set(partitioned.external.map(\.id)) == ["e1", "m1", "g1", "d2"])
  }

  @Test func sortsMutedLastStarredFirstNewestActivity() {
    let rooms = [
      makeRoom(id: "muted", name: "muted", unreadCount: 9, mutedAt: baseDate),
      makeRoom(id: "plain", name: "plain", updatedAt: baseDate),
      makeRoom(id: "starred", name: "starred", starredAt: baseDate, updatedAt: baseDate.addingTimeInterval(-1000)),
      makeRoom(id: "active", name: "active", updatedAt: baseDate.addingTimeInterval(1000)),
    ]
    let partitioned = partitionRoomsForSidebar(rooms)
    #expect(partitioned.channels.map(\.id) == ["starred", "active", "plain", "muted"])
  }

  @Test func directDisplayNameExcludesSelf() {
    let room = makeRoom(
      id: "d1", name: "stale stored name", kind: .direct,
      peers: [makePeer(id: "me", name: "Me"), makePeer(id: "ada", name: "Ada")]
    )
    #expect(roomDisplayName(room, currentUserId: "me") == "Ada")
  }

  @Test func selfOnlyDirectFallsBackToStoredName() {
    // Genuinely ambiguous without opening the room — same fallback as web.
    let room = makeRoom(
      id: "d1", name: "My Name", kind: .direct,
      peers: [makePeer(id: "me", name: "My Name")]
    )
    #expect(roomDisplayName(room, currentUserId: "me") == "My Name")
  }

  @Test func groupDirectJoinsThreeThenCountsRest() {
    let room = makeRoom(
      id: "d1", name: "group", kind: .direct,
      peers: [
        makePeer(id: "me", name: "Me"),
        makePeer(id: "a", name: "Ann"),
        makePeer(id: "b", name: "Bob"),
        makePeer(id: "c", name: "Cat"),
        makePeer(id: "d", name: "Dan"),
      ]
    )
    #expect(roomDisplayName(room, currentUserId: "me") == "Ann, Bob, Cat and 1 more")
  }

  @Test func channelKeepsStoredName() {
    let room = makeRoom(id: "c1", name: "general", peers: [makePeer(id: "me", name: "Me")])
    #expect(roomDisplayName(room, currentUserId: "me") == "general")
  }

  @Test func attentionBadgesMentionsOnlyAndSuppressesMutedNotSelected() {
    #expect(resolveRoomAttention(unreadCount: 3, unreadMentionCount: 0) == .init(bold: true, badgeCount: 0))
    #expect(resolveRoomAttention(unreadCount: 3, unreadMentionCount: 2) == .init(bold: true, badgeCount: 2))
    #expect(resolveRoomAttention(unreadCount: 0, unreadMentionCount: 0, markedUnread: true) == .init(bold: true, badgeCount: 0))
    #expect(resolveRoomAttention(unreadCount: 5, unreadMentionCount: 2, isMuted: true) == .init(bold: false, badgeCount: 0))
    // Selection is not a read event (ADR 0026). List highlight must not
    // clear leftover unread — this slice has no history-resolved mark-read.
    #expect(resolveRoomAttention(unreadCount: 5, unreadMentionCount: 2) == .init(bold: true, badgeCount: 2))
    #expect(resolveRoomAttention(unreadCount: 0, unreadMentionCount: 0) == .init(bold: false, badgeCount: 0))
  }
}
