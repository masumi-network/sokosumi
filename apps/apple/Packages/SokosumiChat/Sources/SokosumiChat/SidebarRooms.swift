import CoreAPI
import Foundation

/// Sidebar sections mirroring web's `partitionRoomsForSidebar`.
public struct PartitionedSidebarRooms: Sendable {
  public var channels: [Components.Schemas.ChatRoom]
  public var directMessages: [Components.Schemas.ChatRoom]
  public var external: [Components.Schemas.ChatRoom]
}

/// Attention chrome mirroring web's `resolveRoomAttention`: muted and
/// selected rooms suppress chrome; the badge counts mentions only, while
/// bold covers any unread (including leftover thread unread, ADR 0013).
public struct RoomAttention: Equatable, Sendable {
  public var bold: Bool
  public var badgeCount: Int

  public init(bold: Bool, badgeCount: Int) {
    self.bold = bold
    self.badgeCount = badgeCount
  }
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
  let humans = room.userMembers
    .filter { $0.id != currentUserId }
    .map { ($0.name.isEmpty ? $0.email : $0.name, $0.id) }
    .sorted(by: compareNameThenId)
  let coworkers = room.coworkerMembers
    .map { ($0.name, $0.id) }
    .sorted(by: compareNameThenId)
  let bots = room.sokoBotMembers
    .map { ($0.name, $0.id) }
    .sorted(by: compareNameThenId)
  let names = (humans + coworkers + bots).map(\.0)
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
  if byName != .orderedSame { return byName == .orderedAscending }
  return lhs.1 < rhs.1
}

public func resolveRoomAttention(
  unreadCount: Int,
  unreadMentionCount: Int,
  markedUnread: Bool = false,
  isMuted: Bool = false,
  isSelected: Bool = false
) -> RoomAttention {
  if isSelected || isMuted {
    return .init(bold: false, badgeCount: 0)
  }
  return .init(bold: unreadCount > 0 || markedUnread, badgeCount: unreadMentionCount)
}

/// Split the unified room list for the sidebar, mirroring web:
/// external/matched channels and guest-access rooms live only under
/// External (guest access is checked before kind, so even a guest Direct
/// reads as External); remaining Directs list under Direct messages.
public func partitionRoomsForSidebar(
  _ rooms: [Components.Schemas.ChatRoom]
) -> PartitionedSidebarRooms {
  var channels: [Components.Schemas.ChatRoom] = []
  var directMessages: [Components.Schemas.ChatRoom] = []
  var external: [Components.Schemas.ChatRoom] = []
  for room in rooms {
    if room.kind == .channel,
      let discoverability = room.discoverability,
      discoverability == .external || discoverability == .matched
    {
      external.append(room)
      continue
    }
    // Guests are always on external rooms (DB invariant); safety net.
    if room.myAccess == .guest {
      external.append(room)
      continue
    }
    switch room.kind {
    case .channel:
      channels.append(room)
    case .direct:
      directMessages.append(room)
    }
  }
  channels.sort(by: compareRoomsByRecentActivity)
  directMessages.sort(by: compareRoomsByRecentActivity)
  external.sort(by: compareRoomsByRecentActivity)
  return .init(channels: channels, directMessages: directMessages, external: external)
}

/// Web's `compareChatRoomsByRecentActivity`: unmuted before muted; pinned
/// (starred) before unpinned; public before private; oldest-starred first
/// among pins; newest activity; stable id tie-break.
public func compareRoomsByRecentActivity(
  _ lhs: Components.Schemas.ChatRoom,
  _ rhs: Components.Schemas.ChatRoom
) -> Bool {
  let byMuted = mutedRank(lhs.mutedAt) - mutedRank(rhs.mutedAt)
  if byMuted != 0 { return byMuted < 0 }
  let lhsPinned = lhs.starredAt != nil
  let rhsPinned = rhs.starredAt != nil
  if lhsPinned != rhsPinned { return lhsPinned }
  let byDiscoverability = discoverabilityRank(lhs.discoverability) - discoverabilityRank(rhs.discoverability)
  if byDiscoverability != 0 { return byDiscoverability < 0 }
  if lhsPinned, let lhsStarred = lhs.starredAt, let rhsStarred = rhs.starredAt,
    lhsStarred != rhsStarred
  {
    return lhsStarred < rhsStarred
  }
  if lhs.updatedAt != rhs.updatedAt {
    return lhs.updatedAt > rhs.updatedAt
  }
  return lhs.id < rhs.id
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
