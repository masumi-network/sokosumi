import CoreAPI

/// How loudly a sidebar label speaks. The one place that decides it: a muted room that is not on screen rests
/// (web's `text-muted-foreground`), a room with something to read is loud, and a switch that is on is active. The
/// view maps each case to a weight and a colour per row type; it never re-derives the case.
public enum SidebarEmphasis: Equatable, Sendable {
  /// Bold and full strength: something is waiting.
  case attention
  /// Regular weight, full strength.
  case normal
  /// Regular weight, muted: nothing to say, or a muted room that is not on screen.
  case atRest
  /// Medium weight in the accent tint: a mode that is on (the Unreads filter).
  case active

  /// A room's name. The selected row stays full strength even when muted, so the room on screen never fades.
  static func room(hasAttention: Bool, isMuted: Bool, isSelected: Bool) -> SidebarEmphasis {
    if hasAttention {
      return .attention
    }
    return isMuted && !isSelected ? .atRest : .normal
  }

  /// A row above the sections that is not a room (Threads, Unreads): loud while something is unread, tinted while
  /// on, at rest otherwise.
  public static func navRow(isActive: Bool, hasUnread: Bool) -> SidebarEmphasis {
    if hasUnread {
      return .attention
    }
    return isActive ? .active : .atRest
  }

  /// A section heading: loud only while it carries the closed section's attention, at rest otherwise.
  public static func header(attention: SectionAttention?) -> SidebarEmphasis {
    attention == nil ? .atRest : .attention
  }
}

/// A trailing count badge: what it prints and what VoiceOver hears in its place. Flags and words only; the view
/// draws it as `Text(verbatim: label).accessibilityLabel(spokenLabel)`.
public struct SidebarBadge: Equatable, Sendable {
  public let label: String
  public let spokenLabel: String

  /// A room's mention badge, capped like every chat count and spoken in web's form; nil draws none.
  public static func room(_ attention: RoomAttention) -> SidebarBadge? {
    guard let label = attention.badgeLabel, let spokenLabel = attention.badgeAccessibilityLabel else {
      return nil
    }
    return SidebarBadge(label: label, spokenLabel: spokenLabel)
  }

  /// The Threads entry's mention badge, spoken as web's "N mentions, N unread threads".
  public static func threadsEntry(_ attention: UnreadThreadsAttention) -> SidebarBadge? {
    guard attention.mentionCount > 0 else { return nil }
    return SidebarBadge(label: roomCountLabel(attention.mentionCount), spokenLabel: attention.accessibilityLabel)
  }

  /// An inset Thread naming the reader: the room rows' mention badge in place of its reply count. Its spoken form
  /// is uncapped. Never reads `row.label`, the costly preview.
  public static func thread(_ row: SidebarThreadRow) -> SidebarBadge? {
    guard row.mentionCount > 0 else { return nil }
    return SidebarBadge(
      label: roomCountLabel(row.mentionCount),
      spokenLabel: row.mentionCount == 1 ? "1 mention" : "\(row.mentionCount) mentions"
    )
  }
}

/// One item of a room's context menu. Titles and symbols are the app's.
public struct RoomMenuEntry: Equatable, Sendable {
  public enum Command: Hashable, Sendable {
    case markUnread, pin, unpin, mute, unmute
    case nameGroup, channelSettings, leave

    /// The sidebar action a quick entry performs; nil for the entries that open a sheet or a confirmation.
    public var sidebarAction: ConversationSidebar.Action? {
      switch self {
      case .markUnread: .markUnread
      case .pin: .pin
      case .unpin: .unpin
      case .mute: .mute
      case .unmute: .unmute
      case .nameGroup, .channelSettings, .leave: nil
      }
    }
  }

  public let command: Command
  public let isEnabled: Bool
}

/// A room's context menu: the quick actions, then, behind a divider, what manages the room.
public struct RoomMenu: Equatable, Sendable {
  /// Mark as unread, Pin or Unpin, Mute or Unmute; enabled as `ConversationSidebar.canPerform` says.
  public let quick: [RoomMenuEntry]
  /// Name Group, Channel settings, Leave channel, in that order, only where the reader may.
  public let manage: [RoomMenuEntry]

  public static let empty = RoomMenu(quick: [], manage: [])

  public var isEmpty: Bool {
    quick.isEmpty && manage.isEmpty
  }

  init(quick: [RoomMenuEntry], manage: [RoomMenuEntry]) {
    self.quick = quick
    self.manage = manage
  }

  init(room: Components.Schemas.ChatRoom, context: SidebarRoomRow.Context) {
    let pin: ConversationSidebar.Action = room.starredAt == nil ? .pin : .unpin
    let mute: ConversationSidebar.Action = room.mutedAt == nil ? .mute : .unmute
    func entry(_ action: ConversationSidebar.Action, _ command: RoomMenuEntry.Command) -> RoomMenuEntry {
      .init(
        command: command,
        isEnabled: ConversationSidebar.canPerform(action, room: room, selectedRoomId: context.selectedRoomId, isPending: context.isPending)
      )
    }
    quick = [
      entry(.markUnread, .markUnread),
      entry(pin, pin == .pin ? .pin : .unpin),
      entry(mute, mute == .mute ? .mute : .unmute)
    ]
    manage = Self.manage(room: room, isOwnerOrAdmin: context.isOwnerOrAdmin, mutationInFlight: context.mutationInFlight)
  }

  /// What manages a room, for the context menu and the Members inspector alike. Group naming is any member's;
  /// settings are an organization owner's or admin's and never wait on a mutation; Leave follows web's rule.
  /// Naming and leaving wait for the workspace's one running mutation.
  public static func manage(
    room: Components.Schemas.ChatRoom, isOwnerOrAdmin: Bool, mutationInFlight: Bool
  ) -> [RoomMenuEntry] {
    var entries: [RoomMenuEntry] = []
    if GroupNameDraft.canName(room) {
      entries.append(.init(command: .nameGroup, isEnabled: !mutationInFlight))
    }
    if ChannelEditPermissions(room: room, isOwnerOrAdmin: isOwnerOrAdmin).canManageSettings {
      entries.append(.init(command: .channelSettings, isEnabled: true))
    }
    if ChannelEditPermissions.canLeave(room) {
      entries.append(.init(command: .leave, isEnabled: !mutationInFlight))
    }
    return entries
  }
}

/// Everything one room row of the sidebar decides: how its name speaks, what its trailing slot shows, its leading
/// mark, its badge and count, and its context menu. The view lays it out; the rules have UI-free tests. Flags and
/// enums only: the app owns every word and symbol.
public struct SidebarRoomRow: Equatable, Sendable {
  /// What the row's view knows besides the room.
  public struct Context: Equatable, Sendable {
    /// The selected room (`ConversationSidebar.selectedRoomId`), not the Threads-view-aware active room.
    public var selectedRoomId: String?
    /// Web's `showsRoomUnreadCount` preference.
    public var showsUnreadCount: Bool
    /// Pinned reorder mode is on and this row sits in Pinned: the handle stands in the status slot, no menu.
    public var reorderingPinned: Bool
    /// The Unreads filter dims a room read in its pass.
    public var dimmed: Bool
    /// A pin, mute or unread mark is running on this room.
    public var isPending: Bool
    /// The room a channel lifecycle change (leave, archive, restore, delete) is running on, if any.
    public var lifecycleRoomId: String?
    /// The workspace's one room mutation is running.
    public var mutationInFlight: Bool
    /// The reader's organization role, as far as it is known.
    public var isOwnerOrAdmin: Bool

    public init(
      selectedRoomId: String?,
      showsUnreadCount: Bool = false,
      reorderingPinned: Bool = false,
      dimmed: Bool = false,
      isPending: Bool = false,
      lifecycleRoomId: String? = nil,
      mutationInFlight: Bool = false,
      isOwnerOrAdmin: Bool = false
    ) {
      self.selectedRoomId = selectedRoomId
      self.showsUnreadCount = showsUnreadCount
      self.reorderingPinned = reorderingPinned
      self.dimmed = dimmed
      self.isPending = isPending
      self.lifecycleRoomId = lifecycleRoomId
      self.mutationInFlight = mutationInFlight
      self.isOwnerOrAdmin = isOwnerOrAdmin
    }
  }

  /// The trailing slot, in priority order.
  public enum Status: Equatable, Sendable {
    case reorderHandle, updating, muted, none
  }

  /// The leading mark, by where the room lists when it is not pinned.
  public enum Mark: Equatable, Sendable {
    case channel(ChannelMark)
    case external
    case directAvatars
  }

  public let emphasis: SidebarEmphasis
  public let status: Status
  public let badge: SidebarBadge?
  /// The reader's Room unread count, drawn only where the row has no mention badge.
  public let unreadCount: Int?
  public let mark: Mark
  public let isDimmed: Bool
  /// Empty while reordering.
  public let menu: RoomMenu

  public init(room: Components.Schemas.ChatRoom, context: Context) {
    let attention = resolveRoomAttention(room, showUnreadCount: context.showsUnreadCount)
    let isMuted = room.mutedAt != nil
    emphasis = .room(hasAttention: attention.bold, isMuted: isMuted, isSelected: room.id == context.selectedRoomId)
    if context.reorderingPinned {
      status = .reorderHandle
    } else if context.isPending || context.lifecycleRoomId == room.id {
      status = .updating
    } else {
      status = isMuted ? .muted : .none
    }
    badge = SidebarBadge.room(attention)
    unreadCount = attention.unreadTextCount > 0 ? attention.unreadTextCount : nil
    switch sidebarRoomKind(room) {
    case .channel: mark = .channel(ChannelMark(room.discoverability))
    case .external: mark = .external
    case .direct: mark = .directAvatars
    }
    isDimmed = context.dimmed
    menu = context.reorderingPinned ? .empty : RoomMenu(room: room, context: context)
  }
}

/// Which of the sidebar's toolbar commands the workspace allows right now.
public struct SidebarCommands: Equatable, Sendable {
  public let newChat: Bool
  public let createChannel: Bool
  public let browseChannels: Bool
  public let refresh: Bool

  public init(phase: WorkspaceSession.Phase, roomsLoading: Bool, mutationInFlight: Bool, hasOrganization: Bool) {
    let isReady = phase == .ready
    newChat = isReady && !roomsLoading && !mutationInFlight
    createChannel = isReady && hasOrganization && !mutationInFlight
    browseChannels = isReady && !mutationInFlight
    refresh = !roomsLoading
  }
}
