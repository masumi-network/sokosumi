import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

/// What each sidebar row, its menu and the toolbar decide, without a view: the rules the Mac and a later iPhone
/// sidebar both draw.
struct SidebarPresentationTests {
  private static let fixedDate = Date(timeIntervalSince1970: 1_790_000_000)

  private static func member(_ id: String, _ access: Components.Schemas.ChatRoomAccess = .member) -> Components.Schemas.ChatRoomUserParticipant {
    .init(id: id, name: id, email: "\(id)@example.com", presence: .online, access: access)
  }

  private static func room(
    id: String = "room_1",
    kind: Components.Schemas.ChatRoom.KindPayload = .channel,
    discoverability: Components.Schemas.ChatRoom.DiscoverabilityPayload? = ._public,
    access: Components.Schemas.ChatRoomAccess = .member,
    isGroupDirect: Bool = false,
    unreadCount: Int = 0,
    unreadMentionCount: Int = 0,
    starred: Bool = false,
    muted: Bool = false,
    members: [Components.Schemas.ChatRoomUserParticipant] = [member("me"), member("peer")]
  ) -> Components.Schemas.ChatRoom {
    .init(
      id: id, organizationId: "org_1", name: "launch", kind: kind, isSelfDirect: false, isGroupDirect: isGroupDirect, isReadOnly: false,
      discoverability: kind == .channel ? discoverability : nil, createdByUserId: "me", createdAt: fixedDate, updatedAt: fixedDate,
      unreadCount: unreadCount, unreadMentionCount: unreadMentionCount, starredAt: starred ? fixedDate : nil,
      mutedAt: muted ? fixedDate : nil, markedUnread: false,
      myAccess: .init(value1: access, value2: .init(stringLiteral: access.rawValue)),
      userMembers: members, formerUserMembers: [], coworkerMembers: [], sokoBotMembers: []
    )
  }

  private static func row(
    _ room: Components.Schemas.ChatRoom, _ context: SidebarRoomRow.Context = .init(selectedRoomId: nil)
  ) -> SidebarRoomRow {
    SidebarRoomRow(room: room, context: context)
  }

  private static func threadRow(mentions: Int, replies: Int = 2) -> SidebarThreadRow {
    SidebarThreadRow(
      roomId: "room_1", parentMessageId: "p-1", firstUnreadReplyId: "p-1-reply", parentContent: "Rollout",
      unreadReplyCount: replies, mentionCount: mentions, mentionNames: [:]
    )
  }

  // MARK: Status

  @Test func theReorderHandleOutranksEverythingInTheStatusSlot() {
    let context = SidebarRoomRow.Context(selectedRoomId: nil, reorderingPinned: true, isPending: true, lifecycleRoomId: "room_1")
    #expect(Self.row(Self.room(muted: true), context).status == .reorderHandle)
  }

  @Test func aPendingActionOrALifecycleChangeOnThisRoomShowsTheSpinnerOverTheBell() {
    let pending = SidebarRoomRow.Context(selectedRoomId: nil, isPending: true)
    #expect(Self.row(Self.room(muted: true), pending).status == .updating)
    let lifecycle = SidebarRoomRow.Context(selectedRoomId: nil, lifecycleRoomId: "room_1")
    #expect(Self.row(Self.room(muted: true), lifecycle).status == .updating)
  }

  @Test func aLifecycleChangeOnAnotherRoomLeavesThisOneAlone() {
    let other = SidebarRoomRow.Context(selectedRoomId: nil, lifecycleRoomId: "room_2")
    #expect(Self.row(Self.room(), other).status == .none)
    #expect(Self.row(Self.room(muted: true), other).status == .muted)
  }

  @Test func aMutedRoomShowsTheBellAndAnyOtherNothing() {
    #expect(Self.row(Self.room(muted: true)).status == .muted)
    #expect(Self.row(Self.room()).status == .none)
  }

  // MARK: Emphasis

  /// Row #5897: the muted rest colour never fades the room on screen.
  @Test func aMutedRoomRestsUnlessItIsSelected() {
    let muted = Self.room(muted: true)
    #expect(Self.row(muted, .init(selectedRoomId: "other")).emphasis == .atRest)
    #expect(Self.row(muted, .init(selectedRoomId: nil)).emphasis == .atRest)
    #expect(Self.row(muted, .init(selectedRoomId: "room_1")).emphasis == .normal)
  }

  @Test func aRoomWithSomethingToReadIsLoudEvenWhenSelected() {
    let unread = Self.room(unreadCount: 2)
    #expect(Self.row(unread, .init(selectedRoomId: "room_1")).emphasis == .attention)
    #expect(Self.row(unread).emphasis == .attention)
    #expect(Self.row(Self.room()).emphasis == .normal)
  }

  @Test func aMutedRoomIsNeverLoud() {
    #expect(Self.row(Self.room(unreadCount: 4, unreadMentionCount: 2, muted: true)).emphasis == .atRest)
  }

  @Test func theThreadsRowRestsAtZeroAndIsLoudWhileAnyThreadIsUnread() {
    #expect(SidebarEmphasis.navRow(isActive: false, hasUnread: false) == .atRest)
    #expect(SidebarEmphasis.navRow(isActive: false, hasUnread: true) == .attention)
    #expect(SidebarEmphasis.navRow(isActive: false, hasUnread: UnreadThreadsAttention(threadCount: 0, mentionCount: 0).isUnread) == .atRest)
    #expect(SidebarEmphasis.navRow(isActive: false, hasUnread: UnreadThreadsAttention(threadCount: 3, mentionCount: 1).isUnread) == .attention)
  }

  /// Row #5907: the Unreads toggle rests muted while off and takes the tint while on.
  @Test func theUnreadsToggleRestsWhenOffAndIsActiveWhenOn() {
    #expect(SidebarEmphasis.navRow(isActive: false, hasUnread: false) == .atRest)
    #expect(SidebarEmphasis.navRow(isActive: true, hasUnread: false) == .active)
  }

  @Test func aHeadingIsLoudOnlyWithAttention() {
    #expect(SidebarEmphasis.header(attention: nil) == .atRest)
    #expect(SidebarEmphasis.header(attention: .unread) == .attention)
    #expect(SidebarEmphasis.header(attention: .mention) == .attention)
  }

  // MARK: Badges

  @Test func aRoomBadgeCapsAtNinetyNineAndSpeaksTheUncappedFloor() {
    let badge = SidebarBadge.room(resolveRoomAttention(Self.room(unreadMentionCount: 150)))
    #expect(badge == SidebarBadge(label: "99+", spokenLabel: "More than 99 mentions"))
    #expect(SidebarBadge.room(resolveRoomAttention(Self.room(unreadMentionCount: 1))) == SidebarBadge(label: "1", spokenLabel: "1 mention"))
    #expect(SidebarBadge.room(resolveRoomAttention(Self.room(unreadMentionCount: 7)))?.spokenLabel == "7 mentions")
    #expect(SidebarBadge.room(resolveRoomAttention(Self.room())) == nil)
  }

  @Test func aDirectOfTwoDrawsNoBadge() {
    let direct = Self.room(kind: .direct, unreadCount: 3, unreadMentionCount: 3, members: [Self.member("me"), Self.member("peer")])
    let row = Self.row(direct)
    #expect(row.badge == nil)
    #expect(row.emphasis == .attention)
  }

  @Test func theRowDrawsTheUnreadCountOnlyWhereThereIsNoBadge() {
    let counted = SidebarRoomRow.Context(selectedRoomId: nil, showsUnreadCount: true)
    #expect(Self.row(Self.room(unreadCount: 4), counted).unreadCount == 4)
    #expect(Self.row(Self.room(unreadCount: 4), .init(selectedRoomId: nil)).unreadCount == nil)
    let named = Self.row(Self.room(unreadCount: 4, unreadMentionCount: 1), counted)
    #expect(named.unreadCount == nil)
    #expect(named.badge?.label == "1")
  }

  @Test func theThreadsEntryBadgeSpeaksWebsWords() {
    let badge = SidebarBadge.threadsEntry(UnreadThreadsAttention(threadCount: 3, mentionCount: 2))
    #expect(badge == SidebarBadge(label: "2", spokenLabel: "2 mentions, 3 unread threads"))
    #expect(SidebarBadge.threadsEntry(UnreadThreadsAttention(threadCount: 3, mentionCount: 0)) == nil)
    #expect(SidebarBadge.threadsEntry(UnreadThreadsAttention(threadCount: 5, mentionCount: 150))?.label == "99+")
  }

  @Test func aThreadBadgeCapsItsLabelAndNeverCapsItsSpeech() {
    #expect(SidebarBadge.thread(Self.threadRow(mentions: 0)) == nil)
    #expect(SidebarBadge.thread(Self.threadRow(mentions: 1)) == SidebarBadge(label: "1", spokenLabel: "1 mention"))
    #expect(SidebarBadge.thread(Self.threadRow(mentions: 150)) == SidebarBadge(label: "99+", spokenLabel: "150 mentions"))
  }

  // MARK: Mark

  @Test(arguments: [
    (Components.Schemas.ChatRoom.DiscoverabilityPayload._public, SidebarRoomRow.Mark.channel(.hash)),
    (._private, .channel(.lock)),
    (.external, .external),
    (.matched, .external)
  ])
  func aChannelsMarkFollowsItsDiscoverability(example: (Components.Schemas.ChatRoom.DiscoverabilityPayload, SidebarRoomRow.Mark)) {
    #expect(Self.row(Self.room(discoverability: example.0)).mark == example.1)
  }

  @Test func aGuestsDirectIsExternalAndAnyOtherDirectDrawsFaces() {
    #expect(Self.row(Self.room(kind: .direct, access: .guest)).mark == .external)
    #expect(Self.row(Self.room(kind: .direct)).mark == .directAvatars)
    #expect(Self.row(Self.room(kind: .direct, isGroupDirect: true)).mark == .directAvatars)
  }

  @Test func theDimmedFlagIsTheContexts() {
    #expect(Self.row(Self.room(), .init(selectedRoomId: nil, dimmed: true)).isDimmed)
    #expect(!Self.row(Self.room()).isDimmed)
  }

  // MARK: Menu

  @Test func theQuickEntriesStandInOrderAndFlipWithTheRoomsState() {
    let plain = Self.row(Self.room()).menu
    #expect(plain.quick.map(\.command) == [.markUnread, .pin, .mute])
    let pinned = Self.row(Self.room(starred: true)).menu
    #expect(pinned.quick.map(\.command) == [.markUnread, .unpin, .mute])
    let muted = Self.row(Self.room(muted: true)).menu
    #expect(muted.quick.map(\.command) == [.markUnread, .pin, .unmute])
  }

  @Test func theQuickEntriesAreEnabledAsCanPerformSays() {
    // A plain room: everything is open, except marking the selected room unread.
    #expect(Self.row(Self.room()).menu.quick.map(\.isEnabled) == [true, true, true])
    #expect(Self.row(Self.room(), .init(selectedRoomId: "room_1")).menu.quick.map(\.isEnabled) == [false, true, true])
    // Pinned rooms cannot be muted, muted rooms cannot be pinned or marked.
    #expect(Self.row(Self.room(starred: true)).menu.quick.map(\.isEnabled) == [true, true, false])
    #expect(Self.row(Self.room(muted: true)).menu.quick.map(\.isEnabled) == [false, false, true])
    // A running pin, mute or mark closes all three.
    #expect(Self.row(Self.room(), .init(selectedRoomId: nil, isPending: true)).menu.quick.map(\.isEnabled) == [false, false, false])
  }

  @Test func eachQuickEntryIsEnabledByItsOwnActionsRule() throws {
    for room in [Self.room(), Self.room(starred: true), Self.room(muted: true)] {
      for selected in [nil, "room_1"] {
        for pending in [false, true] {
          let menu = Self.row(room, .init(selectedRoomId: selected, isPending: pending)).menu
          for entry in menu.quick {
            let action = try #require(entry.command.sidebarAction)
            #expect(entry.isEnabled == ConversationSidebar.canPerform(action, room: room, selectedRoomId: selected, isPending: pending))
          }
        }
      }
    }
  }

  @MainActor @Test func theStaticRuleIsTheInstanceRule() {
    let sidebar = ConversationSidebar()
    sidebar.rooms = [Self.room(), Self.room(id: "room_2", starred: true), Self.room(id: "room_3", muted: true)]
    sidebar.selectedRoomId = "room_2"
    for room in sidebar.rooms {
      for action in [ConversationSidebar.Action.markUnread, .pin, .unpin, .mute, .unmute] {
        #expect(
          sidebar.canPerform(action, roomId: room.id)
            == ConversationSidebar.canPerform(action, room: room, selectedRoomId: "room_2", isPending: false)
        )
      }
    }
    #expect(!sidebar.canPerform(.pin, roomId: "missing"))
  }

  @Test func theManageListFollowsTheReadersRoleInAChannel() {
    let channel = Self.room()
    let admin = RoomMenu.manage(room: channel, isOwnerOrAdmin: true, mutationInFlight: false)
    #expect(admin.map(\.command) == [.channelSettings, .leave])
    #expect(admin.map(\.isEnabled) == [true, true])
    let member = RoomMenu.manage(room: channel, isOwnerOrAdmin: false, mutationInFlight: false)
    #expect(member.map(\.command) == [.leave])
  }

  @Test func theLastHostMemberCannotLeaveButAnAdminStillGetsSettings() {
    let alone = Self.room(members: [Self.member("me")])
    #expect(RoomMenu.manage(room: alone, isOwnerOrAdmin: true, mutationInFlight: false).map(\.command) == [.channelSettings])
    #expect(RoomMenu.manage(room: alone, isOwnerOrAdmin: false, mutationInFlight: false).isEmpty)
  }

  @Test func aGuestOrMatchedChannelOffersLeaveAndNeverSettings() {
    let guest = Self.room(discoverability: .external, access: .guest, members: [Self.member("me", .guest)])
    #expect(RoomMenu.manage(room: guest, isOwnerOrAdmin: true, mutationInFlight: false).map(\.command) == [.leave])
    let matched = Self.room(discoverability: .matched, members: [Self.member("me")])
    #expect(RoomMenu.manage(room: matched, isOwnerOrAdmin: true, mutationInFlight: false).map(\.command) == [.leave])
  }

  @Test func aGroupDirectOffersNameGroupAndNothingElse() {
    let group = Self.room(kind: .direct, isGroupDirect: true, members: [Self.member("me"), Self.member("a"), Self.member("b")])
    #expect(RoomMenu.manage(room: group, isOwnerOrAdmin: true, mutationInFlight: false).map(\.command) == [.nameGroup])
    let pair = Self.room(kind: .direct)
    #expect(RoomMenu.manage(room: pair, isOwnerOrAdmin: true, mutationInFlight: false).isEmpty)
  }

  @Test func aRunningMutationClosesNamingAndLeavingButNotSettings() {
    let channel = Self.room()
    let busy = RoomMenu.manage(room: channel, isOwnerOrAdmin: true, mutationInFlight: true)
    #expect(busy.map(\.command) == [.channelSettings, .leave])
    #expect(busy.map(\.isEnabled) == [true, false])
    let group = Self.room(kind: .direct, isGroupDirect: true, members: [Self.member("me"), Self.member("a"), Self.member("b")])
    #expect(RoomMenu.manage(room: group, isOwnerOrAdmin: false, mutationInFlight: true).map(\.isEnabled) == [false])
  }

  @Test func theRowMenuCarriesTheManageListAndEmptiesWhileReordering() {
    let context = SidebarRoomRow.Context(selectedRoomId: nil, mutationInFlight: true, isOwnerOrAdmin: true)
    let menu = Self.row(Self.room(), context).menu
    #expect(menu.manage == RoomMenu.manage(room: Self.room(), isOwnerOrAdmin: true, mutationInFlight: true))
    #expect(!menu.isEmpty)
    let reordering = SidebarRoomRow.Context(selectedRoomId: nil, reorderingPinned: true, isOwnerOrAdmin: true)
    #expect(Self.row(Self.room(starred: true), reordering).menu == .empty)
    #expect(RoomMenu.empty.isEmpty)
  }

  @Test func eachQuickCommandNamesItsSidebarAction() {
    #expect(RoomMenuEntry.Command.markUnread.sidebarAction == .markUnread)
    #expect(RoomMenuEntry.Command.pin.sidebarAction == .pin)
    #expect(RoomMenuEntry.Command.unpin.sidebarAction == .unpin)
    #expect(RoomMenuEntry.Command.mute.sidebarAction == .mute)
    #expect(RoomMenuEntry.Command.unmute.sidebarAction == .unmute)
    #expect(RoomMenuEntry.Command.nameGroup.sidebarAction == nil)
    #expect(RoomMenuEntry.Command.channelSettings.sidebarAction == nil)
    #expect(RoomMenuEntry.Command.leave.sidebarAction == nil)
  }

  // MARK: Commands

  @Test func newChatNeedsAReadyWorkspaceNoLoadAndNoMutation() {
    func newChat(_ phase: WorkspaceSession.Phase, loading: Bool = false, busy: Bool = false) -> Bool {
      SidebarCommands(phase: phase, roomsLoading: loading, mutationInFlight: busy, hasOrganization: true).newChat
    }
    #expect(newChat(.ready))
    #expect(!newChat(.loading))
    #expect(!newChat(.idle))
    #expect(!newChat(.updateRequired))
    #expect(!newChat(.ready, loading: true))
    #expect(!newChat(.ready, busy: true))
  }

  @Test func createChannelNeedsAnOrganizationAndNoMutationButMayRunWhileLoading() {
    func create(_ phase: WorkspaceSession.Phase = .ready, loading: Bool = false, busy: Bool = false, organization: Bool = true) -> Bool {
      SidebarCommands(phase: phase, roomsLoading: loading, mutationInFlight: busy, hasOrganization: organization).createChannel
    }
    #expect(create())
    #expect(create(loading: true))
    #expect(!create(.loading))
    #expect(!create(busy: true))
    #expect(!create(organization: false))
  }

  @Test func browseChannelsNeedsAReadyWorkspaceAndNoMutation() {
    func browse(_ phase: WorkspaceSession.Phase = .ready, loading: Bool = false, busy: Bool = false, organization: Bool = false) -> Bool {
      SidebarCommands(phase: phase, roomsLoading: loading, mutationInFlight: busy, hasOrganization: organization).browseChannels
    }
    #expect(browse())
    #expect(browse(loading: true))
    #expect(!browse(.failed(message: "no")))
    #expect(!browse(busy: true))
  }

  @Test func refreshWaitsOnlyForALoadInFlight() {
    func refresh(_ phase: WorkspaceSession.Phase, loading: Bool) -> Bool {
      SidebarCommands(phase: phase, roomsLoading: loading, mutationInFlight: true, hasOrganization: false).refresh
    }
    #expect(refresh(.ready, loading: false))
    #expect(refresh(.idle, loading: false))
    #expect(!refresh(.ready, loading: true))
  }
}
