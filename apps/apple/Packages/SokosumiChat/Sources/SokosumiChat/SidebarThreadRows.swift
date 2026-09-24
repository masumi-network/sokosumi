import CoreAPI
import Foundation

/// One of a room's unread Threads, inset under its sidebar row (row 24g2; web `ChatRoomThreadRows`, ADR 0037).
/// It opens the Thread at its first unread reply through the chat notification's link, whose Look reads it.
public struct SidebarThreadRow: Identifiable, Equatable, Sendable {
  public let roomId: String
  public let parentMessageId: String
  /// Where opening the row lands: the oldest reply still unread.
  public let firstUnreadReplyId: String
  public let parentContent: String
  public let unreadReplyCount: Int
  /// Unread replies in this Thread naming the reader (web: absent on an older snapshot, so zero).
  public let mentionCount: Int
  /// The room's members by mention id, for the preview.
  public let mentionNames: [String: String]

  public var id: String {
    "\(roomId)/\(parentMessageId)"
  }

  /// Web's `formatUnreadThreadsPreview`: the parent as one mention-aware line, or "Thread" when it has no
  /// text. Costly (it runs the preview's expressions), so a view reads it once per change of the row.
  public var label: String {
    let preview = ChatMessagePreview.text(parentContent, names: mentionNames)
    return preview.isEmpty ? "Thread" : preview
  }

  /// The row's one drawn number: the muted unread reply count, capped like every chat count, or nothing
  /// where the mention badge stands for the row.
  public var countLabel: String? {
    mentionCount > 0 ? nil : roomCountLabel(unreadReplyCount)
  }

  /// Web's spoken reply count (`ThreadRows.unreadReplies`), uncapped. Web also speaks "N mentions" in the row;
  /// on Apple the mention badge carries that label, so the row does not say it a second time.
  public var accessibilityValue: String {
    unreadReplyCount == 1 ? "1 unread reply" : "\(unreadReplyCount) unread replies"
  }
}

/// What a sidebar section lists: each room, followed by its inset unread Threads and the overflow row.
public enum SidebarRoomListItem: Identifiable, Equatable, Sendable {
  case room(Components.Schemas.ChatRoom)
  case thread(SidebarThreadRow)
  /// Web's "N more unread threads": what Core's cap left out, opening the room's thread overview.
  case moreThreads(roomId: String, count: Int)

  public var id: String {
    switch self {
    case let .room(room): room.id
    case let .thread(row): row.id
    case let .moreThreads(roomId, _): "\(roomId)/more-threads"
    }
  }
}

/// The room's inset unread Threads: `unreadThreads` exactly as Core sends it (newest unread reply first,
/// capped at three by Core), none for a muted room, which lists nothing (web's room mute outranks them).
public func sidebarThreadRows(_ room: Components.Schemas.ChatRoom) -> [SidebarThreadRow] {
  guard room.mutedAt == nil, let threads = room.unreadThreads, !threads.isEmpty else { return [] }
  let names = MessageMentions(room: room).previewNames
  return threads.map {
    SidebarThreadRow(
      roomId: room.id, parentMessageId: $0.parentMessageId, firstUnreadReplyId: $0.firstUnreadReplyId,
      parentContent: $0.parentContent, unreadReplyCount: $0.unreadReplyCount,
      mentionCount: max(0, $0.unreadMentionCount ?? 0), mentionNames: names
    )
  }
}

/// What the cap left out: `unreadThreadCount` past the listed rows, falling back to the listed count for a
/// summary that predates it. Zero while nothing is listed, since web then draws no rows at all.
public func sidebarMoreThreadsCount(_ room: Components.Schemas.ChatRoom) -> Int {
  let listed = room.unreadThreads?.count ?? 0
  guard listed > 0 else { return 0 }
  return max(0, (room.unreadThreadCount ?? listed) - listed)
}

/// A section's rows: each room, then its inset Threads and overflow row. Pinned reorder mode lists rooms only,
/// so rows keep one height under the pointer (web hides the inset rows while reordering).
public func sidebarRoomListItems(_ rooms: [Components.Schemas.ChatRoom], reordering: Bool = false) -> [SidebarRoomListItem] {
  rooms.flatMap { room -> [SidebarRoomListItem] in
    let rows = reordering ? [] : sidebarThreadRows(room)
    guard !rows.isEmpty else { return [.room(room)] }
    let more = sidebarMoreThreadsCount(room)
    return [.room(room)] + rows.map(SidebarRoomListItem.thread) + (more > 0 ? [.moreThreads(roomId: room.id, count: more)] : [])
  }
}

/// Web's `ThreadRows.moreThreads`.
public func moreUnreadThreadsLabel(_ count: Int) -> String {
  count == 1 ? "1 more unread thread" : "\(count) more unread threads"
}
