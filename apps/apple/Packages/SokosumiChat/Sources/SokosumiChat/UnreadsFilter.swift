import CoreAPI
import Foundation

/// Web's `roomUnreadReads` (row 24f2, ADR 0037): what reading a room would still clear, as its two reads.
/// `readRoom` while its row is bold, `lookThreads` while it holds an unread Thread. The Unreads filter keeps a
/// room while it needs either, and Mark all as read runs exactly these. Bold is asked of `resolveRoomAttention`,
/// so the filter cannot keep a room its row leaves quiet; muted rooms need nothing.
public struct RoomUnreadReads: Equatable, Sendable {
  public let roomId: String
  public let readRoom: Bool
  public let lookThreads: Bool

  public init(roomId: String, readRoom: Bool, lookThreads: Bool) {
    self.roomId = roomId
    self.readRoom = readRoom
    self.lookThreads = lookThreads
  }

  /// A read would still change the room.
  public var isNeeded: Bool {
    readRoom || lookThreads
  }
}

public func roomUnreadReads(_ room: Components.Schemas.ChatRoom) -> RoomUnreadReads {
  let isMuted = room.mutedAt != nil
  return .init(
    roomId: room.id,
    readRoom: resolveRoomAttention(room).bold,
    lookThreads: !isMuted && (room.unreadThreadCount ?? room.unreadThreads?.count ?? 0) > 0
  )
}

/// Mark all as read's plan: every room a read would still change, with the reads it needs.
public func unreadsMarkAllTargets(_ rooms: [Components.Schemas.ChatRoom]) -> [RoomUnreadReads] {
  rooms.map(roomUnreadReads).filter(\.isNeeded)
}

/// Web's `UnreadFilterPass` (SOK-1159): one pass of the Unreads filter, from switching it on to switching it off
/// or changing workspace. `seen` is every room that was unread at some point in the pass, in the order the filter
/// lists them; a room read since keeps its place, dimmed, so nothing moves out from under the reader.
public struct UnreadsFilterPass: Equatable, Sendable {
  public private(set) var seen: [String] = []

  public init() {}

  /// Web's `advanceUnreadFilterPass`: `unreadIds` come newest activity first. The first call lists them in that
  /// order; a room that turns unread later goes on top; a room already listed keeps its place.
  public func advanced(unreadIds: [String]) -> UnreadsFilterPass {
    let listed = Set(seen)
    let arrived = unreadIds.filter { !listed.contains($0) }
    guard !arrived.isEmpty else { return self }
    var next = self
    next.seen = arrived + seen
    return next
  }
}

/// What the sidebar lists while the Unreads filter is on (web `organization-chat-list.client.tsx`).
public struct UnreadsFilterList: Equatable, Sendable {
  /// The pass after the rooms moved; the sidebar keeps it so the next update starts from it.
  public let pass: UnreadsFilterPass
  /// The flat list: each unpinned room of the pass in its place, then the open room when the pass has not.
  public let rooms: [Components.Schemas.ChatRoom]
  /// Every pinned room in the reader's own order, below the list and any pending invitation.
  public let pinned: [Components.Schemas.ChatRoom]
  /// Nothing is unread and no invitation waits: the "All caught up" row leads.
  public let caughtUp: Bool
  /// Caught up with rooms still listed: "Read just now" says why they are.
  public let showsReadLabel: Bool
  /// Mark all as read stands on the filter's row while this is not empty.
  public let markAllTargets: [RoomUnreadReads]
  private let dimmedRoomIds: Set<String>

  init(
    pass: UnreadsFilterPass, rooms: [Components.Schemas.ChatRoom], pinned: [Components.Schemas.ChatRoom], caughtUp: Bool,
    showsReadLabel: Bool, markAllTargets: [RoomUnreadReads], dimmedRoomIds: Set<String>
  ) {
    self.pass = pass
    self.rooms = rooms
    self.pinned = pinned
    self.caughtUp = caughtUp
    self.showsReadLabel = showsReadLabel
    self.markAllTargets = markAllTargets
    self.dimmedRoomIds = dimmedRoomIds
  }

  /// A listed room with nothing unread, read in this pass or pinned, draws dimmed; the open room never does.
  public func isDimmed(_ roomId: String) -> Bool {
    dimmedRoomIds.contains(roomId)
  }
}

/// The filter's list from the rooms (attention applied), the pass so far and the open room.
public func unreadsFilterList(
  rooms: [Components.Schemas.ChatRoom], pass: UnreadsFilterPass, activeRoomId: String?, hasPendingInvitation: Bool
) -> UnreadsFilterList {
  // One answer for what the filter lists and whether the reader is caught up, so the two cannot disagree.
  let unread = rooms
    .filter { roomUnreadReads($0).isNeeded }
    .sorted { $0.updatedAt != $1.updatedAt ? $0.updatedAt > $1.updatedAt : $0.id < $1.id }
  let unreadIds = Set(unread.map(\.id))
  // The flat list never takes a pinned room, so none shows twice or leaves Pinned when it turns unread.
  let pinned = partitionRoomsForSidebar(rooms).pinned
  let pinnedIds = Set(pinned.map(\.id))
  let next = pass.advanced(unreadIds: unread.map(\.id).filter { !pinnedIds.contains($0) })
  let byId = Dictionary(rooms.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
  // The open room is listed while it is open, read or not. A room pinned during the pass leaves the list; the
  // pass keeps its place, so unpinning puts it back where it was.
  let openIds = activeRoomId.map { next.seen.contains($0) ? [] : [$0] } ?? []
  let listed = (next.seen + openIds).filter { !pinnedIds.contains($0) }.compactMap { byId[$0] }
  // Read rooms dim, but not the open one: dimmed, its highlight reads as disabled.
  let dimmed = Set((listed + pinned).map(\.id).filter { !unreadIds.contains($0) && $0 != activeRoomId })
  // A pending invitation waits on the reader, so it keeps them from being caught up. Caught up is about what is
  // unread, not what is listed.
  let caughtUp = unread.isEmpty && !hasPendingInvitation
  return .init(
    pass: next, rooms: listed, pinned: pinned, caughtUp: caughtUp, showsReadLabel: caughtUp && !listed.isEmpty,
    markAllTargets: unreadsMarkAllTargets(rooms), dimmedRoomIds: dimmed
  )
}

/// Web remembers the filter per browser, one value for every workspace (`chat_unreads_filter` cookie, #5158).
/// On Apple it belongs to this install. `transient` remembers nothing: tests and previews.
public struct UnreadsFilterPreference: @unchecked Sendable {
  public static let defaultsKey = "sokosumi.chat-unreads-filter.v1"
  private let defaults: UserDefaults?

  public init(defaults: UserDefaults?) {
    self.defaults = defaults
  }

  public static var standard: UnreadsFilterPreference {
    .init(defaults: .standard)
  }

  public static var transient: UnreadsFilterPreference {
    .init(defaults: nil)
  }

  /// Off until the reader switches it on.
  public var isOn: Bool {
    get { defaults?.bool(forKey: Self.defaultsKey) ?? false }
    nonmutating set { defaults?.set(newValue, forKey: Self.defaultsKey) }
  }
}
