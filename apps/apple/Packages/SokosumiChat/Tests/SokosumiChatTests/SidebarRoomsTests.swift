import CoreAPI
import Foundation
import SokosumiChat
import Testing

private let baseDate = Date(timeIntervalSince1970: 1_700_000_000)

private func makePeer(
  id: String,
  name: String,
  email: String? = nil,
  image: String? = nil
) -> Components.Schemas.ChatRoomUserParticipant {
  .init(
    id: id,
    name: name,
    email: email ?? "\(id)@example.com",
    image: image,
    presence: .online
  )
}

private func makeCoworker(
  id: String,
  name: String,
  image: String? = nil
) -> Components.Schemas.ChatRoomCoworkerParticipant {
  .init(id: id, name: name, slug: id, caption: nil, image: image, presence: .online)
}

private func makeSokoBot(
  id: String,
  name: String,
  image: String? = nil
) -> Components.Schemas.ChatRoomSokoBotParticipant {
  .init(id: id, name: name, caption: nil, image: image, avatarSeed: nil, presence: .online)
}

private func makeRoom(
  id: String,
  name: String,
  kind: Components.Schemas.ChatRoom.KindPayload = .channel,
  isSelfDirect: Bool = false,
  isGroupDirect: Bool = false,
  groupName: String? = nil,
  discoverability: Components.Schemas.ChatRoom.DiscoverabilityPayload? = ._public,
  myAccess: Components.Schemas.ChatRoomAccess = .member,
  unreadCount: Int = 0,
  unreadMentionCount: Int = 0,
  markedUnread: Bool = false,
  starredAt: Date? = nil,
  mutedAt: Date? = nil,
  updatedAt: Date = baseDate,
  peers: [Components.Schemas.ChatRoomUserParticipant] = [],
  coworkers: [Components.Schemas.ChatRoomCoworkerParticipant] = [],
  sokoBots: [Components.Schemas.ChatRoomSokoBotParticipant] = []
) -> Components.Schemas.ChatRoom {
  .init(
    id: id,
    name: name,
    kind: kind, isSelfDirect: isSelfDirect, isGroupDirect: isGroupDirect, groupName: groupName,
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
    coworkerMembers: coworkers,
    sokoBotMembers: sokoBots
  )
}

struct SidebarRoomsTests {
  @MainActor @Test func sidebarRestoresValidSelectionAndFallsBackToDisplayOrder() throws {
    let suite = "sidebar-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let saved = SavedRoomSelection(defaults: defaults)
    let state = ConversationSidebar(savedRoom: saved)
    state.rooms = [makeRoom(id: "old", name: "Old"), makeRoom(id: "new", name: "New", updatedAt: baseDate.addingTimeInterval(10))]
    #expect(state.restoredSelection(userId: "me", organizationId: nil) == "new")
    state.select("old", userId: "me", organizationId: nil)
    state.selectedRoomId = nil
    #expect(state.restoredSelection(userId: "me", organizationId: nil) == "old")
    #expect(state.restoredSelection(userId: "other", organizationId: nil) == "new")
    state.select("missing", userId: "me", organizationId: nil)
    #expect(state.selectedRoomId == nil)
    state.rooms.removeAll { $0.id == "old" }
    #expect(state.restoredSelection(userId: "me", organizationId: nil) == "new")
    // Pinned is the first section, so its first room is the fallback.
    state.rooms.append(makeRoom(id: "pin", name: "Pin", starredAt: baseDate))
    state.selectedRoomId = nil
    #expect(state.restoredSelection(userId: "other", organizationId: nil) == "pin")
  }

  @MainActor @Test func sectionCollapsePreservesSelectionAndResetsWithAccount() {
    let state = ConversationSidebar()
    state.rooms = [makeRoom(id: "one", name: "One")]
    state.selectedRoomId = "one"
    #expect(state.collapsedSections == [.archived])
    state.setExpanded(false, section: .channels)
    #expect(state.collapsedSections == [.channels, .archived])
    #expect(state.selectedRoomId == "one")
    state.setExpanded(true, section: .channels)
    state.setExpanded(true, section: .archived)
    #expect(state.collapsedSections.isEmpty)
    state.setExpanded(false, section: .directs)
    state.reset()
    #expect(state.rooms.isEmpty)
    #expect(state.selectedRoomId == nil)
    #expect(state.collapsedSections == [.archived])
  }

  @Test func partitionsChannelsDirectsAndExternal() {
    let rooms = [
      makeRoom(id: "c1", name: "general"),
      makeRoom(id: "d1", name: "Ada", kind: .direct),
      makeRoom(id: "e1", name: "partner", discoverability: .external),
      makeRoom(id: "m1", name: "matched", discoverability: .matched),
      makeRoom(id: "g1", name: "guest-room", myAccess: .guest),
      // Guest access always reads as External (checked before kind),
      // even for a Direct.
      makeRoom(id: "d2", name: "Guest Peer", kind: .direct, myAccess: .guest)
    ]
    let partitioned = partitionRoomsForSidebar(rooms)
    #expect(partitioned.channels.map(\.id) == ["c1"])
    #expect(partitioned.directMessages.map(\.id) == ["d1"])
    #expect(Set(partitioned.external.map(\.id)) == ["e1", "m1", "g1", "d2"])
  }

  @Test func sortsMutedLastPublicBeforePrivateNewestActivity() {
    let rooms = [
      makeRoom(id: "muted", name: "muted", unreadCount: 9, mutedAt: baseDate),
      makeRoom(id: "plain", name: "plain", updatedAt: baseDate),
      makeRoom(id: "private", name: "private", discoverability: ._private, updatedAt: baseDate.addingTimeInterval(2000)),
      makeRoom(id: "active", name: "active", updatedAt: baseDate.addingTimeInterval(1000))
    ]
    let partitioned = partitionRoomsForSidebar(rooms)
    #expect(partitioned.pinned.isEmpty)
    #expect(partitioned.channels.map(\.id) == ["active", "plain", "private", "muted"])
  }

  @Test func pinnedRoomsOfAnyKindLeaveTheirSectionInTheReadersOrder() {
    let rooms = [
      makeRoom(id: "c1", name: "general"),
      // A private pin above a public one, a busy pin below a quiet one: only `starredAt` orders Pinned.
      makeRoom(id: "p-public", name: "public", starredAt: baseDate.addingTimeInterval(30), updatedAt: baseDate.addingTimeInterval(9000)),
      makeRoom(id: "p-private", name: "private", discoverability: ._private, starredAt: baseDate.addingTimeInterval(10)),
      makeRoom(id: "p-direct", name: "Ada", kind: .direct, starredAt: baseDate.addingTimeInterval(20)),
      makeRoom(id: "p-guest", name: "guest", myAccess: .guest, starredAt: baseDate.addingTimeInterval(40)),
      makeRoom(id: "p-b", name: "tie b", discoverability: .external, starredAt: baseDate.addingTimeInterval(50)),
      makeRoom(id: "p-a", name: "tie a", starredAt: baseDate.addingTimeInterval(50)),
      makeRoom(id: "d1", name: "Bob", kind: .direct)
    ]
    let partitioned = partitionRoomsForSidebar(rooms)
    #expect(partitioned.pinned.map(\.id) == ["p-private", "p-direct", "p-public", "p-guest", "p-a", "p-b"])
    #expect(partitioned.channels.map(\.id) == ["c1"])
    #expect(partitioned.directMessages.map(\.id) == ["d1"])
    #expect(partitioned.external.isEmpty)
    #expect(partitioned.pinned.map(sidebarRoomKind) == [.channel, .direct, .channel, .external, .channel, .external])
  }

  @Test func keyboardMoveSwapsWithTheNeighbourAndStopsAtTheEnds() {
    let ids = ["a", "b", "c"]
    #expect(movingPinnedRoom("b", by: -1, in: ids) == ["b", "a", "c"])
    #expect(movingPinnedRoom("b", by: 1, in: ids) == ["a", "c", "b"])
    #expect(movingPinnedRoom("a", by: -1, in: ids) == ids)
    #expect(movingPinnedRoom("c", by: 1, in: ids) == ids)
    #expect(movingPinnedRoom("missing", by: 1, in: ids) == ids)
  }

  @Test func closedSectionAttentionIsItsLoudestRooms() {
    #expect(resolveSectionAttention([makeRoom(id: "quiet", name: "quiet")]) == nil)
    #expect(resolveSectionAttention([makeRoom(id: "muted", name: "muted", unreadCount: 3, unreadMentionCount: 1, mutedAt: baseDate)]) == nil)
    #expect(resolveSectionAttention([makeRoom(id: "unread", name: "unread", unreadCount: 1)]) == .unread)
    #expect(resolveSectionAttention([makeRoom(id: "marked", name: "marked", markedUnread: true)]) == .unread)
    #expect(resolveSectionAttention([
      makeRoom(id: "unread", name: "unread", unreadCount: 1),
      makeRoom(id: "mention", name: "mention", unreadCount: 1, unreadMentionCount: 1)
    ]) == .mention)
    #expect(resolveSectionAttention([], hasPendingInvitation: true) == .mention)
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
        makePeer(id: "d", name: "Dan")
      ]
    )
    #expect(roomDisplayName(room, currentUserId: "me") == "Ann, Bob, Cat and 1 more")
  }

  @Test func namedGroupDirectShowsItsGroupName() {
    let members = [makePeer(id: "me", name: "Me"), makePeer(id: "a", name: "Ann"), makePeer(id: "b", name: "Bob")]
    let named = makeRoom(id: "d1", name: "Ann, Bob", kind: .direct, isGroupDirect: true, groupName: "Launch crew", peers: members)
    #expect(roomDisplayName(named, currentUserId: "me") == "Launch crew")
    let unnamed = makeRoom(id: "d2", name: "Ann, Bob", kind: .direct, isGroupDirect: true, peers: members)
    #expect(roomDisplayName(unnamed, currentUserId: "me") == "Ann, Bob")
  }

  @Test func oneToOneAndSelfDirectsKeepTheirNames() {
    let oneToOne = makeRoom(id: "d1", name: "Ann", kind: .direct, peers: [makePeer(id: "me", name: "Me"), makePeer(id: "a", name: "Ann")])
    #expect(roomDisplayName(oneToOne, currentUserId: "me") == "Ann")
    let selfDirect = makeRoom(id: "d2", name: "Me", kind: .direct, isSelfDirect: true, peers: [makePeer(id: "me", name: "Me")])
    #expect(roomDisplayName(selfDirect, currentUserId: "me") == "Me")
  }

  @Test func oneToOneDirectAvatarExcludesSelfAndKeepsPeerImage() {
    let room = makeRoom(
      id: "d1", name: "Ada", kind: .direct,
      peers: [
        makePeer(id: "me", name: "Me", image: "https://example.com/me.png"),
        makePeer(id: "ada", name: "Ada Lovelace", image: "https://example.com/ada.png")
      ]
    )
    let faces = directRoomAvatarParticipants(room, currentUserId: "me")
    #expect(faces.map(\.id) == ["ada"])
    #expect(faces.map(\.name) == ["Ada Lovelace"])
    #expect(faces.map(\.imageURL) == ["https://example.com/ada.png"])
  }

  @Test func selfOnlyDirectHasNoAvatarParticipants() {
    let room = makeRoom(
      id: "d1", name: "My Name", kind: .direct,
      peers: [makePeer(id: "me", name: "My Name")]
    )
    #expect(directRoomAvatarParticipants(room, currentUserId: "me").isEmpty)
  }

  @Test func groupDirectAvatarCapsAtThreeInNameOrder() {
    let room = makeRoom(
      id: "d1", name: "group", kind: .direct,
      peers: [
        makePeer(id: "me", name: "Me"),
        makePeer(id: "d", name: "Dan"),
        makePeer(id: "a", name: "Ann"),
        makePeer(id: "c", name: "Cat"),
        makePeer(id: "b", name: "Bob")
      ]
    )
    #expect(
      directRoomAvatarParticipants(room, currentUserId: "me").map(\.id) == ["a", "b", "c"]
    )
  }

  @Test func coworkersFollowHumansThenSokoBots() {
    let room = makeRoom(
      id: "d1", name: "mixed", kind: .direct,
      peers: [
        makePeer(id: "me", name: "Me"),
        makePeer(id: "ada", name: "Ada")
      ],
      coworkers: [makeCoworker(id: "cw-1", name: "Matt", image: "https://example.com/matt.png")],
      sokoBots: [makeSokoBot(id: "bot-1", name: "Soko Bot")]
    )
    let faces = directRoomAvatarParticipants(room, currentUserId: "me")
    #expect(faces.map(\.id) == ["ada", "cw-1", "bot-1"])
    #expect(faces.map(\.imageURL) == [nil, "https://example.com/matt.png", nil])
  }

  @Test func emptyHumanNameUsesEmailForAvatar() {
    let room = makeRoom(
      id: "d1", name: "dm", kind: .direct,
      peers: [
        makePeer(id: "me", name: "Me"),
        makePeer(id: "ada", name: "", email: "ada@example.com")
      ]
    )
    #expect(directRoomAvatarParticipants(room, currentUserId: "me").map(\.name) == ["ada@example.com"])
  }

  @Test func channelHasNoDirectAvatarParticipants() {
    let room = makeRoom(
      id: "c1", name: "general",
      peers: [makePeer(id: "ada", name: "Ada", image: "https://example.com/ada.png")]
    )
    #expect(directRoomAvatarParticipants(room, currentUserId: "me").isEmpty)
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
    // Selection is not a read event (ADR 0026) and the resolver has no selection input, so
    // the List highlight cannot clear leftover unread.
    #expect(resolveRoomAttention(unreadCount: 5, unreadMentionCount: 2) == .init(bold: true, badgeCount: 2))
    #expect(resolveRoomAttention(unreadCount: 0, unreadMentionCount: 0) == .init(bold: false, badgeCount: 0))
  }

  /// Was `…ObeysMuteAndTheOpenRoom`: its last line asserted a count of zero for `isActive`.
  /// Web's resolver has no such input, so the argument is gone and only mute silences the count.
  /// Its second line drew the count beside the badge; since SOK-1147 a row draws one number (row 24g1).
  @Test func unreadTextCountIsOptInAndObeysMute() {
    #expect(resolveRoomAttention(unreadCount: 3, unreadMentionCount: 0).unreadTextCount == 0)
    #expect(resolveRoomAttention(unreadCount: 3, unreadMentionCount: 0, showUnreadCount: true) == .init(bold: true, badgeCount: 0, unreadTextCount: 3))
    #expect(resolveRoomAttention(unreadCount: 3, unreadMentionCount: 1, showUnreadCount: true) == .init(bold: true, badgeCount: 1))
    // Forced unread without messages stays bold with no number.
    #expect(resolveRoomAttention(unreadCount: 0, unreadMentionCount: 0, markedUnread: true, showUnreadCount: true) == .init(bold: true, badgeCount: 0))
    #expect(resolveRoomAttention(unreadCount: 3, unreadMentionCount: 1, isMuted: true, showUnreadCount: true).unreadTextCount == 0)
  }

  @Test func roomCountCapsAtNinetyNine() {
    #expect(roomCountLabel(1) == "1" && roomCountLabel(99) == "99" && roomCountLabel(100) == "99+")
    #expect(roomUnreadAccessibilityLabel(1) == "1 unread message")
    #expect(roomUnreadAccessibilityLabel(42) == "42 unread messages")
    #expect(roomUnreadAccessibilityLabel(250) == "More than 99 unread messages")
  }

  /// Web `RoomMentionBadge` / `MentionAnnouncement`: nothing at zero, the shared cap above 99.
  @Test(arguments: zip([-1, 0, 1, 42, 99, 100, 250], [nil, nil, "1", "42", "99", "99+", "99+"] as [String?]))
  func mentionBadgeCapsAtNinetyNineAndHidesAtZero(mentions: Int, label: String?) {
    #expect(resolveRoomAttention(unreadCount: max(0, mentions), unreadMentionCount: mentions).badgeLabel == label)
  }

  @Test(arguments: zip(
    [-1, 0, 1, 42, 99, 100, 250],
    [nil, nil, "1 mention", "42 mentions", "99 mentions", "More than 99 mentions", "More than 99 mentions"] as [String?]
  ))
  func mentionBadgeIsSpokenLikeWeb(mentions: Int, spoken: String?) {
    #expect(resolveRoomAttention(unreadCount: max(0, mentions), unreadMentionCount: mentions).badgeAccessibilityLabel == spoken)
  }

  /// Was `mutedAndOpenRoomsShowNoMentionBadge`: the open-room half asserted no badge for
  /// `isActive`. The open room now resolves like any other row; a real selection is covered by
  /// `ConversationActionsTests.openRoomKeepsItsAttention` and the app's `OpenRoomAttentionTests`.
  @Test func mutedRoomsShowNoMentionBadge() {
    #expect(resolveRoomAttention(unreadCount: 250, unreadMentionCount: 250, isMuted: true).badgeLabel == nil)
    #expect(resolveRoomAttention(unreadCount: 250, unreadMentionCount: 250, isMuted: true).badgeAccessibilityLabel == nil)
  }
}
