import CoreAPI

/// The thread overview's loaded threads divided under "Unread" and "Earlier", as web's
/// `ThreadListPanel` divides them (row 24d).
///
/// A partition of what is loaded, in Core's order: nothing extra is fetched, and Core lists unread
/// threads first, so an older page only grows Earlier. A row moves when the overview loads again, never
/// on a local guess: going back from a thread and Mark all both reload the first page.
public struct RoomThreadOverviewGroups: Equatable, Sendable {
  public let unread: [Components.Schemas.ChatRoomThread]
  public let earlier: [Components.Schemas.ChatRoomThread]

  public init(threads: [Components.Schemas.ChatRoomThread]) {
    unread = threads.filter(Self.isUnread)
    earlier = threads.filter { !Self.isUnread($0) }
  }

  /// Web's `threadNeedsOverviewUnread`: Core's participant-gated `unreadReplyCount` alone. Core already
  /// applies the mute rule, so a muted thread counts here only while a mention in it is unread.
  public static func isUnread(_ thread: Components.Schemas.ChatRoomThread) -> Bool {
    thread.unreadReplyCount > 0
  }

  /// Any loaded thread heads the list with Unread, even when none is unread. A room with no threads
  /// keeps its own empty state instead.
  public var showsUnreadHeading: Bool {
    !unread.isEmpty || !earlier.isEmpty
  }

  /// "All caught up" stands under the Unread heading in place of rows.
  public var isCaughtUp: Bool {
    unread.isEmpty && !earlier.isEmpty
  }

  /// Earlier shows only once a read thread is loaded.
  public var showsEarlierHeading: Bool {
    !earlier.isEmpty
  }
}
