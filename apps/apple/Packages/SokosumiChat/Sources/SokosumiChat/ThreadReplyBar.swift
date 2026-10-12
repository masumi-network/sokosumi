import CoreAPI
import Foundation

/// Web's `THREAD_REPLY_FACE_CAP`: faces on a reply bar. Core caps `threadRepliers` at the same.
private let threadReplyFaceCap = 3

/// The bar under a thread parent in the room transcript (row 24h; web `ThreadReplyBar`, ADR 0037): who
/// replied, how many replies or how many are new to this reader, and when the last one landed.
public struct ThreadReplyBar: Equatable, Sendable {
  /// One replier's face, decoration beside the count.
  public struct Face: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let imageURL: String?
  }

  public let replyCount: Int
  /// This reader's unread replies. The transcript takes it from the room's unread-thread read, not the event.
  public let unreadReplyCount: Int
  /// Who replied, in the order they joined, as Core lists them; none on a message the client built.
  public let faces: [Face]
  public let lastReplyAt: Date?

  /// Nil for a message nobody replied to: web draws the bar only while `threadReplyCount > 0`.
  public init?(message: Components.Schemas.ChatRoomMessage) {
    guard message.threadReplyCount > 0 else { return nil }
    replyCount = message.threadReplyCount
    unreadReplyCount = max(0, message.threadUnreadReplyCount ?? 0)
    faces = (message.threadRepliers ?? []).enumerated().map { index, sender in
      Face(id: chatSenderKey(sender) ?? "unknown-\(index)", name: messageSenderName(sender), imageURL: messageSenderImage(sender))
    }
    lastReplyAt = message.threadLastReplyAt
  }

  public var isUnread: Bool {
    unreadReplyCount > 0
  }

  /// Web's `Thread.newReplyCount` / `Thread.replyCount`, the bar's accessible name.
  public var label: String {
    if isUnread {
      return unreadReplyCount == 1 ? "1 new reply" : "\(unreadReplyCount) new replies"
    }
    return replyCount == 1 ? "1 reply" : "\(replyCount) replies"
  }
}

/// Web's `applyThreadUnreadReplyCounts`: once the room's unread-thread read has answered, it owns every
/// reply bar's count, and a parent absent from it has none.
public func applyThreadUnreadReplyCounts(
  _ messages: [Components.Schemas.ChatRoomMessage],
  counts: [String: Int]
) -> [Components.Schemas.ChatRoomMessage] {
  messages.map { message in
    let unread = counts[message.id] ?? 0
    guard (message.threadUnreadReplyCount ?? 0) != unread else { return message }
    var updated = message
    updated.threadUnreadReplyCount = unread
    return updated
  }
}

/// Web's `clearThreadUnreadReplies` on the loaded rows: a Look or Mark all zeroes the bars it cleared at
/// once, for a room whose unread-thread read has not answered yet.
public func clearingThreadUnreadReplies(
  _ messages: [Components.Schemas.ChatRoomMessage],
  where isCleared: (String) -> Bool
) -> [Components.Schemas.ChatRoomMessage] {
  messages.map { message in
    guard (message.threadUnreadReplyCount ?? 0) > 0, isCleared(message.id) else { return message }
    var updated = message
    updated.threadUnreadReplyCount = 0
    return updated
  }
}

/// Web's `keepKnownThreadUnreadReplyCount`: only the message list computes the reader's count. A realtime
/// event is broadcast to the whole room and leaves it out, so a fresher copy keeps the count already known.
func keepKnownThreadUnreadReplyCount(
  known: Components.Schemas.ChatRoomMessage?,
  incoming: Components.Schemas.ChatRoomMessage
) -> Components.Schemas.ChatRoomMessage {
  guard incoming.threadUnreadReplyCount == nil, let count = known?.threadUnreadReplyCount else { return incoming }
  var updated = incoming
  updated.threadUnreadReplyCount = count
  return updated
}

/// Web's `applyReplyToParentThreadPreview`, after this client posts a reply: Core does not republish the
/// parent, so the bar counts the reply, takes its age and adds its sender last unless they already replied.
public func applyingReplyToParentThreadPreview(
  _ parent: Components.Schemas.ChatRoomMessage,
  reply: Components.Schemas.ChatRoomMessage
) -> Components.Schemas.ChatRoomMessage {
  var updated = parent
  updated.threadReplyCount += 1
  updated.threadLastReplyAt = reply.createdAt
  let repliers = parent.threadRepliers ?? []
  if let key = chatSenderKey(reply.sender), !repliers.contains(where: { chatSenderKey($0) == key }) {
    updated.threadRepliers = Array((repliers + [reply.sender]).prefix(threadReplyFaceCap))
  }
  return updated
}
