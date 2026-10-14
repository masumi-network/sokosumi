import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

/// Which sections the sidebar stands, how a closed heading speaks and what each lists (web's
/// `organization-chat-list.client.tsx`), without a view.
struct SidebarSectionsTests {
  private static let fixedDate = Date(timeIntervalSince1970: 1_790_000_000)
  private static let open: Set<ConversationSidebar.Section> = []

  private static func room(
    _ id: String, unread: Int = 0, mentions: Int = 0
  ) -> Components.Schemas.ChatRoom {
    .init(
      id: id, organizationId: "org_1", name: id, kind: .channel, isSelfDirect: false, isGroupDirect: false, isReadOnly: false,
      discoverability: ._public, createdByUserId: "me", createdAt: fixedDate, updatedAt: fixedDate,
      unreadCount: unread, unreadMentionCount: mentions, markedUnread: false,
      myAccess: .init(value1: .member, value2: "member"),
      userMembers: [], formerUserMembers: [], coworkerMembers: [], sokoBotMembers: []
    )
  }

  private static func partitioned(
    pinned: [Components.Schemas.ChatRoom] = [], channels: [Components.Schemas.ChatRoom] = [],
    directs: [Components.Schemas.ChatRoom] = [], external: [Components.Schemas.ChatRoom] = []
  ) -> PartitionedSidebarRooms {
    .init(pinned: pinned, channels: channels, directMessages: directs, external: external)
  }

  private static func sections(
    _ partitioned: PartitionedSidebarRooms = partitioned(), invitations: Bool = false,
    archived: [Components.Schemas.ChatRoom] = [], organization: Bool = true,
    collapsed: Set<ConversationSidebar.Section> = open, reordering: Bool = false
  ) -> SidebarSections {
    SidebarSections(
      partitioned: partitioned, hasInvitations: invitations, archived: archived, hasOrganization: organization,
      collapsed: collapsed, pinnedReorderMode: reordering
    )
  }

  // MARK: Visibility

  @Test func pinnedStandsOnlyOnceSomethingIsPinned() {
    #expect(!Self.sections().pinned.isVisible)
    #expect(Self.sections(Self.partitioned(pinned: [Self.room("a")])).pinned.isVisible)
  }

  @Test func channelsNeedAnOrganization() {
    #expect(Self.sections().channels.isVisible)
    #expect(!Self.sections(organization: false).channels.isVisible)
    #expect(!Self.sections(Self.partitioned(channels: [Self.room("a")]), organization: false).channels.isVisible)
  }

  @Test func externalStandsWithRoomsOrWithInvitationsAlone() {
    #expect(!Self.sections().external.isVisible)
    #expect(Self.sections(Self.partitioned(external: [Self.room("a")])).external.isVisible)
    #expect(Self.sections(invitations: true).external.isVisible)
    #expect(Self.sections(invitations: true, organization: false).external.isVisible)
  }

  @Test func archivedNeedsAnOrganizationAndRooms() {
    #expect(!Self.sections().archived.isVisible)
    #expect(!Self.sections(archived: [Self.room("a")], organization: false).archived.isVisible)
    #expect(!Self.sections(archived: []).archived.isVisible)
    #expect(Self.sections(archived: [Self.room("a")]).archived.isVisible)
  }

  @Test func directsAlwaysStand() {
    #expect(Self.sections().directs.isVisible)
    #expect(Self.sections(organization: false).directs.isVisible)
    #expect(Self.sections(collapsed: [.directs]).directs.isVisible)
  }

  @Test func allListsTheSectionsInDrawOrder() {
    #expect(Self.sections().all.map(\.kind) == [.pinned, .channels, .external, .archived, .directs])
  }

  // MARK: Empty state

  @Test func onlyAnOpenEmptyChannelsOrDirectsShowsItsLine() {
    let empty = Self.sections()
    #expect(empty.channels.showsEmptyState)
    #expect(empty.directs.showsEmptyState)
    #expect(!empty.pinned.showsEmptyState && !empty.external.showsEmptyState && !empty.archived.showsEmptyState)
    let filled = Self.sections(Self.partitioned(channels: [Self.room("a")], directs: [Self.room("b")]))
    #expect(!filled.channels.showsEmptyState && !filled.directs.showsEmptyState)
    let closed = Self.sections(collapsed: [.channels, .directs])
    #expect(!closed.channels.showsEmptyState && !closed.directs.showsEmptyState)
    #expect(!Self.sections(organization: false).channels.showsEmptyState)
  }

  // MARK: Header attention

  @Test func theHeadingIsSilentWhileTheSectionIsOpen() {
    let loud = Self.partitioned(
      pinned: [Self.room("p", mentions: 1)], channels: [Self.room("c", mentions: 2)],
      directs: [Self.room("d", unread: 3)], external: [Self.room("e", unread: 1)]
    )
    for section in Self.sections(loud, invitations: true).all {
      #expect(section.headerAttention == nil, "\(section.kind)")
    }
  }

  @Test func aClosedHeadingSaysWhatItsRoomsWouldHaveSaid() {
    let loud = Self.partitioned(
      pinned: [Self.room("p", mentions: 1)], channels: [Self.room("c", unread: 2)], directs: [Self.room("d")]
    )
    let closed = Self.sections(loud, collapsed: [.pinned, .channels, .directs])
    #expect(closed.pinned.headerAttention == .mention)
    #expect(closed.channels.headerAttention == .unread)
    #expect(closed.directs.headerAttention == nil)
  }

  @Test func aPendingInvitationMakesAClosedExternalHeadingAMention() {
    #expect(Self.sections(invitations: true, collapsed: [.external]).external.headerAttention == .mention)
    #expect(Self.sections(invitations: true).external.headerAttention == nil)
    let quiet = Self.sections(Self.partitioned(external: [Self.room("e")]), collapsed: [.external])
    #expect(quiet.external.headerAttention == nil)
  }

  @Test func archivedNeverCarriesAttention() {
    #expect(Self.sections(archived: [Self.room("a", unread: 4, mentions: 2)], collapsed: [.archived]).archived.headerAttention == nil)
  }

  @Test func theFiltersExternalSectionIsTheInvitationsAlone() {
    let open = SidebarSection.externalInvitations(collapsed: Self.open)
    #expect(open.kind == .external && open.isVisible && !open.isCollapsed)
    #expect(open.headerAttention == nil && open.items.isEmpty)
    #expect(SidebarSection.externalInvitations(collapsed: [.external]).headerAttention == .mention)
  }

  // MARK: Collapse and items

  @Test func collapsedFollowsTheSet() {
    let sections = Self.sections(collapsed: [.channels, .archived])
    #expect(sections.channels.isCollapsed && sections.archived.isCollapsed)
    #expect(!sections.directs.isCollapsed && !sections.pinned.isCollapsed)
  }

  @Test func anOpenSectionListsItsRoomsAndAClosedOneNothing() {
    let rooms = Self.partitioned(channels: [Self.room("a"), Self.room("b")])
    #expect(Self.sections(rooms).channels.items.map(\.id) == ["a", "b"])
    #expect(Self.sections(rooms, collapsed: [.channels]).channels.items.isEmpty)
    #expect(Self.sections(rooms, organization: false).channels.items.isEmpty)
  }

  @Test func archivedListsPlainRooms() {
    let archived = Self.sections(archived: [Self.room("x"), Self.room("y")]).archived
    #expect(archived.items.map(\.id) == ["x", "y"])
    #expect(archived.items == [.room(Self.room("x")), .room(Self.room("y"))])
  }

  @Test func reorderModeListsPinnedRoomsOnly() {
    let threaded = Components.Schemas.ChatRoom(
      id: "t", organizationId: "org_1", name: "t", kind: .channel, isSelfDirect: false, isGroupDirect: false, isReadOnly: false,
      discoverability: ._public, createdByUserId: "me", createdAt: Self.fixedDate, updatedAt: Self.fixedDate,
      unreadCount: 1, unreadThreadCount: 1,
      unreadThreads: [.init(
        parentMessageId: "p", firstUnreadReplyId: "p-r", parentContent: "Rollout", unreadReplyCount: 1, unreadMentionCount: 0
      )],
      unreadMentionCount: 0, markedUnread: false, myAccess: .init(value1: .member, value2: "member"),
      userMembers: [], formerUserMembers: [], coworkerMembers: [], sokoBotMembers: []
    )
    let rooms = Self.partitioned(pinned: [threaded, Self.room("u")])
    #expect(Self.sections(rooms).pinned.items.map(\.id) == ["t", "t/p", "u"])
    #expect(Self.sections(rooms, reordering: true).pinned.items.map(\.id) == ["t", "u"])
  }
}
