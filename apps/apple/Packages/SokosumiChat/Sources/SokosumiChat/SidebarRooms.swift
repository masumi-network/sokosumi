import CoreAPI
import Foundation

/// Sidebar sections mirroring web's `partitionRoomsForSidebar`.
public struct PartitionedSidebarRooms: Sendable {
  public var pinned: [Components.Schemas.ChatRoom]
  public var channels: [Components.Schemas.ChatRoom]
  public var directMessages: [Components.Schemas.ChatRoom]
  public var external: [Components.Schemas.ChatRoom]
}

/// Attention chrome mirroring web's `resolveRoomAttention`: muted rooms
/// and the active room suppress chrome — the active transcript has
/// resolved and marks read via `RoomReadAttention` (ADR 0026). Bold
/// covers any unread, including leftover thread unread (ADR 0013).
/// `unreadTextCount` is the reader's opt-in Room unread count: a third field,
/// because the badge keeps counting mentions only.
public struct RoomAttention: Equatable, Sendable {
  public var bold: Bool
  public var badgeCount: Int
  public var unreadTextCount: Int

  public init(bold: Bool, badgeCount: Int, unreadTextCount: Int = 0) {
    self.bold = bold
    self.badgeCount = badgeCount
    self.unreadTextCount = unreadTextCount
  }
}

/// Web `ROOM_COUNT_CAP`: a very loud room cannot reflow its row.
public let roomCountCap = 99

/// Web `roomCountLabel`: the count, capped as "99+".
public func roomCountLabel(_ count: Int) -> String {
  count > roomCountCap ? "\(roomCountCap)+" : String(count)
}

/// Spoken form of the Room unread count (web `RoomUnread.unreadMessages*`).
public func roomUnreadAccessibilityLabel(_ count: Int) -> String {
  if count > roomCountCap {
    return "More than \(roomCountCap) unread messages"
  }
  return count == 1 ? "1 unread message" : "\(count) unread messages"
}

/// One face in a Direct sidebar stack. Mirrors web's `DirectRoomAvatarStack`
/// participant: other humans (not you), then coworkers, then Soko Bots.
public struct DirectRoomAvatarParticipant: Equatable, Sendable, Identifiable {
  public var id: String
  public var name: String
  public var imageURL: String?
  /// Coworkers and Soko Bots stay always-online (ADR 0003 v1).
  public var isAI: Bool
  /// Core's snapshot; humans overlay live org presence on top.
  public var presence: Components.Schemas.ChatRoomPresence

  public init(id: String, name: String, imageURL: String?, isAI: Bool = false, presence: Components.Schemas.ChatRoomPresence = .offline) {
    self.id = id
    self.name = name
    self.imageURL = imageURL
    self.isAI = isAI
    self.presence = presence
  }
}

/// Faces for a Direct sidebar row. Empty means the row should show the
/// message glyph (self-only Direct, or not a Direct). Caps at 3, same
/// order as `roomDisplayName`.
public func directRoomAvatarParticipants(
  _ room: Components.Schemas.ChatRoom,
  currentUserId: String
) -> [DirectRoomAvatarParticipant] {
  Array(directRoomOtherParticipants(room, currentUserId: currentUserId).prefix(3))
}

/// Other humans (not you), then coworkers, then Soko Bots — the same
/// ordered set `roomDisplayName` joins and the sidebar stack caps at 3.
private func directRoomOtherParticipants(
  _ room: Components.Schemas.ChatRoom,
  currentUserId: String
) -> [DirectRoomAvatarParticipant] {
  guard room.kind == .direct else { return [] }
  let humans = room.userMembers
    .filter { $0.id != currentUserId }
    .map {
      DirectRoomAvatarParticipant(
        id: $0.id,
        name: $0.name.isEmpty ? $0.email : $0.name,
        imageURL: $0.image,
        presence: $0.presence
      )
    }
    .sorted(by: compareParticipants)
  let coworkers = room.coworkerMembers
    .map {
      DirectRoomAvatarParticipant(id: $0.id, name: $0.name, imageURL: $0.image, isAI: true, presence: $0.presence)
    }
    .sorted(by: compareParticipants)
  let bots = room.sokoBotMembers
    .map {
      DirectRoomAvatarParticipant(id: $0.id, name: $0.name, imageURL: $0.image, isAI: true, presence: $0.presence)
    }
    .sorted(by: compareParticipants)
  return humans + coworkers + bots
}

private func compareParticipants(
  _ lhs: DirectRoomAvatarParticipant,
  _ rhs: DirectRoomAvatarParticipant
) -> Bool {
  compareNameThenId((lhs.name, lhs.id), (rhs.name, rhs.id))
}

/// Sidebar display name mirroring web's `getRoomDisplayName`: channels and
/// external rooms use the stored name; Directs list the participants with
/// yourself excluded (humans by name-or-email, then coworkers, then bots).
/// A self-only Direct falls back to the stored name — which is why several
/// distinct self-note rooms can all read as your own name.
public func roomDisplayName(
  _ room: Components.Schemas.ChatRoom,
  currentUserId: String
) -> String {
  guard room.kind == .direct else { return room.name }
  let names = directRoomOtherParticipants(room, currentUserId: currentUserId).map(\.name)
  if names.isEmpty {
    let target = room.userMembers.first { $0.id != currentUserId }
      ?? room.userMembers.first
    if let target {
      return target.name.isEmpty ? target.email : target.name
    }
    return room.name
  }
  if names.count <= 3 {
    return names.joined(separator: ", ")
  }
  return "\(names.prefix(3).joined(separator: ", ")) and \(names.count - 3) more"
}

private func compareNameThenId(_ lhs: (String, String), _ rhs: (String, String)) -> Bool {
  let byName = lhs.0.localizedCompare(rhs.0)
  if byName != .orderedSame {
    return byName == .orderedAscending
  }
  return lhs.1 < rhs.1
}

public func resolveRoomAttention(
  unreadCount: Int,
  unreadMentionCount: Int,
  markedUnread: Bool = false,
  isMuted: Bool = false,
  isActive: Bool = false,
  showUnreadCount: Bool = false
) -> RoomAttention {
  if isMuted || isActive {
    return .init(bold: false, badgeCount: 0)
  }
  return .init(
    bold: unreadCount > 0 || markedUnread,
    badgeCount: unreadMentionCount,
    unreadTextCount: showUnreadCount ? max(0, unreadCount) : 0
  )
}

/// Web's `SectionAttention`: what a closed section heading says for the rooms
/// under it.
public enum SectionAttention: Equatable, Sendable {
  case unread, mention
}

/// Web's `resolveSectionAttention`: a section's attention is its loudest
/// room's, by the same rules a row follows. Mention wins; a pending invitation
/// is addressed to the reader, so it counts as a mention.
public func resolveSectionAttention(
  _ rooms: [Components.Schemas.ChatRoom],
  hasPendingInvitation: Bool = false
) -> SectionAttention? {
  var unread = false
  for room in rooms {
    let attention = resolveRoomAttention(
      unreadCount: room.unreadCount,
      unreadMentionCount: room.unreadMentionCount,
      markedUnread: room.markedUnread,
      isMuted: room.mutedAt != nil
    )
    if attention.badgeCount > 0 {
      return .mention
    }
    unread = unread || attention.bold
  }
  if hasPendingInvitation {
    return .mention
  }
  return unread ? .unread : nil
}

/// Where a room lists when it is not pinned; a pinned row keeps this kind's leading mark.
public enum SidebarRoomKind: Sendable {
  case channel, external, direct
}

/// External/matched channels and guest-access rooms read as External (guest
/// access is checked before kind, so even a guest Direct does); remaining
/// Directs are Direct messages.
public func sidebarRoomKind(_ room: Components.Schemas.ChatRoom) -> SidebarRoomKind {
  if room.kind == .channel,
     let discoverability = room.discoverability,
     discoverability == .external || discoverability == .matched {
    return .external
  }
  // Guests are always on external rooms (DB invariant); safety net.
  if room.myAccess == .guest {
    return .external
  }
  return room.kind == .channel ? .channel : .direct
}

/// Split the unified room list for the sidebar, mirroring web: a pinned room
/// of any kind lists under Pinned only, in the reader's own order, and leaves
/// the section it would otherwise sit in (`sidebarRoomKind`).
public func partitionRoomsForSidebar(
  _ rooms: [Components.Schemas.ChatRoom]
) -> PartitionedSidebarRooms {
  var pinned: [Components.Schemas.ChatRoom] = []
  var channels: [Components.Schemas.ChatRoom] = []
  var directMessages: [Components.Schemas.ChatRoom] = []
  var external: [Components.Schemas.ChatRoom] = []
  for room in rooms {
    if room.starredAt != nil {
      pinned.append(room)
      continue
    }
    switch sidebarRoomKind(room) {
    case .channel: channels.append(room)
    case .external: external.append(room)
    case .direct: directMessages.append(room)
    }
  }
  pinned.sort(by: comparePinnedRooms)
  channels.sort(by: compareRoomsByRecentActivity)
  directMessages.sort(by: compareRoomsByRecentActivity)
  external.sort(by: compareRoomsByRecentActivity)
  return .init(pinned: pinned, channels: channels, directMessages: directMessages, external: external)
}

/// Web's `compareChatRoomsByRecentActivity`: unmuted before muted; public
/// before private; newest activity; stable id tie-break. Pinned rooms never
/// reach this: the sidebar lists them in their own section, ordered by
/// `comparePinnedRooms`.
public func compareRoomsByRecentActivity(
  _ lhs: Components.Schemas.ChatRoom,
  _ rhs: Components.Schemas.ChatRoom
) -> Bool {
  let byMuted = mutedRank(lhs.mutedAt) - mutedRank(rhs.mutedAt)
  if byMuted != 0 {
    return byMuted < 0
  }
  let byDiscoverability = discoverabilityRank(lhs.discoverability) - discoverabilityRank(rhs.discoverability)
  if byDiscoverability != 0 {
    return byDiscoverability < 0
  }
  if lhs.updatedAt != rhs.updatedAt {
    return lhs.updatedAt > rhs.updatedAt
  }
  return lhs.id < rhs.id
}

/// Web's `comparePinnedChatRooms`, the reader's own order: oldest `starredAt`
/// first, which a reorder rewrites (Core `PUT /chats/rooms/starred`). Activity
/// never moves a pinned room.
public func comparePinnedRooms(
  _ lhs: Components.Schemas.ChatRoom,
  _ rhs: Components.Schemas.ChatRoom
) -> Bool {
  let lhsStarred = lhs.starredAt ?? .distantPast
  let rhsStarred = rhs.starredAt ?? .distantPast
  if lhsStarred != rhsStarred {
    return lhsStarred < rhsStarred
  }
  return lhs.id < rhs.id
}

/// Keyboard reorder: `ids` with `id` moved one slot up (`-1`) or down (`1`).
/// Unchanged past either end of the list or for an unknown id.
public func movingPinnedRoom(_ id: String, by offset: Int, in ids: [String]) -> [String] {
  guard let from = ids.firstIndex(of: id), ids.indices.contains(from + offset) else { return ids }
  var next = ids
  next.swapAt(from, from + offset)
  return next
}

private func mutedRank(_ value: Date?) -> Int {
  value == nil ? 0 : 1
}

/// Public / external / matched / null (directs) before private.
private func discoverabilityRank(
  _ value: Components.Schemas.ChatRoom.DiscoverabilityPayload?
) -> Int {
  value == ._private ? 1 : 0
}
