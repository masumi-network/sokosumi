import CoreAPI

/// One section of the sidebar as the Unreads-filter-off layout draws it: whether it stands, how its heading speaks
/// and what it lists. Flags and rooms only: the app owns every title and empty-state text, keyed by `kind`.
public struct SidebarSection: Equatable, Sendable {
  public let kind: ConversationSidebar.Section
  /// Web hides Pinned until something is pinned, Channels and Archived outside an organization, External until a
  /// room or an invitation is in it, and Archived while empty. Directs always stand.
  public let isVisible: Bool
  public let isCollapsed: Bool
  /// Web's `closedAttention`: a closed section hides the rows that carry its rooms' attention, so the heading
  /// says it. Nil while the section is open (its rooms speak for themselves) and for Archived.
  public let headerAttention: SectionAttention?
  /// "No channels yet." / "No direct messages yet.": only an open Channels or Directs section with no room.
  public let showsEmptyState: Bool
  /// What an open, visible section lists, in draw order; empty while it is closed, so a closed section builds
  /// nothing it does not draw. Archived lists plain rooms. Pending invitations are the view's own rows.
  public let items: [SidebarRoomListItem]

  /// `reordering` is Pinned reorder mode: rooms only, so the move offsets stay room offsets.
  init(
    kind: ConversationSidebar.Section,
    rooms: [Components.Schemas.ChatRoom],
    isVisible: Bool,
    collapsed: Set<ConversationSidebar.Section>,
    hasPendingInvitation: Bool = false,
    reordering: Bool = false
  ) {
    let isCollapsed = collapsed.contains(kind)
    self.kind = kind
    self.isVisible = isVisible
    self.isCollapsed = isCollapsed
    headerAttention = switch kind {
    case .archived: nil
    case .pinned, .channels, .external, .directs:
      isCollapsed ? resolveSectionAttention(rooms, hasPendingInvitation: hasPendingInvitation) : nil
    }
    showsEmptyState = isVisible && !isCollapsed && rooms.isEmpty && (kind == .channels || kind == .directs)
    items = switch (isVisible && !isCollapsed, kind) {
    case (false, _): []
    case (true, .archived): rooms.map(SidebarRoomListItem.room)
    case (true, _): sidebarRoomListItems(rooms, reordering: reordering)
    }
  }

  /// The External section of the Unreads filter, which keeps only the pending invitations: they wait on the
  /// reader (web), so they stand even when no room is listed.
  public static func externalInvitations(collapsed: Set<ConversationSidebar.Section>) -> SidebarSection {
    SidebarSection(kind: .external, rooms: [], isVisible: true, collapsed: collapsed, hasPendingInvitation: true)
  }
}

/// The five sections of the sidebar, in the order they are drawn.
public struct SidebarSections: Equatable, Sendable {
  public let pinned: SidebarSection
  public let channels: SidebarSection
  public let external: SidebarSection
  public let archived: SidebarSection
  public let directs: SidebarSection

  public var all: [SidebarSection] {
    [pinned, channels, external, archived, directs]
  }

  public init(
    partitioned: PartitionedSidebarRooms,
    hasInvitations: Bool,
    archived archivedRooms: [Components.Schemas.ChatRoom],
    hasOrganization: Bool,
    collapsed: Set<ConversationSidebar.Section>,
    pinnedReorderMode: Bool = false
  ) {
    pinned = SidebarSection(
      kind: .pinned, rooms: partitioned.pinned, isVisible: !partitioned.pinned.isEmpty, collapsed: collapsed,
      reordering: pinnedReorderMode
    )
    channels = SidebarSection(kind: .channels, rooms: partitioned.channels, isVisible: hasOrganization, collapsed: collapsed)
    external = SidebarSection(
      kind: .external, rooms: partitioned.external, isVisible: !partitioned.external.isEmpty || hasInvitations,
      collapsed: collapsed, hasPendingInvitation: hasInvitations
    )
    archived = SidebarSection(
      kind: .archived, rooms: archivedRooms, isVisible: hasOrganization && !archivedRooms.isEmpty, collapsed: collapsed
    )
    directs = SidebarSection(kind: .directs, rooms: partitioned.directMessages, isVisible: true, collapsed: collapsed)
  }
}
