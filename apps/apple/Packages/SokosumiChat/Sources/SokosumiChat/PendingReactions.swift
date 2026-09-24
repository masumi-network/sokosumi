import CoreAPI

/// Cap on named reactors Core returns per emoji; `count` may still exceed it.
public let maxListedReactionReactors = 20

/// The viewer's add or remove of one emoji on one message, shown before Core confirms (ADR 0032).
public struct PendingReaction: Hashable, Sendable {
  public let messageId: String
  public let emoji: String
  public var reacted: Bool

  public init(messageId: String, emoji: String, reacted: Bool) {
    self.messageId = messageId
    self.emoji = emoji
    self.reacted = reacted
  }
}

/// Who to list among the reactors; `name` is nil when no roster names the viewer.
public struct PendingReactionViewer: Hashable, Sendable {
  public let id: String
  public let name: String?

  public init(id: String, name: String?) {
    self.id = id
    self.name = name
  }
}

/// The viewer's latest intent per message and emoji, layered over confirmed
/// rows until the request settles. Confirmed rows are never written, so a
/// realtime patch or a refreshed page cannot take a tap back, and dropping
/// an intent is the rollback. Message ids are unique across rooms: an intent
/// only ever shows on the message it belongs to.
public struct PendingReactions: Equatable, Sendable {
  /// Oldest first, so two new emoji on one message keep their tap order.
  public private(set) var intents: [PendingReaction] = []

  public init() {}

  public func intent(messageId: String, emoji: String) -> Bool? {
    intents.first { $0.messageId == messageId && $0.emoji == emoji }?.reacted
  }

  /// Flip what the row shows and keep it as the newest intent. Returns the
  /// intent to send, or nil when a request for this message and emoji is
  /// already running: that request sends the newest intent once it returns.
  public mutating func tap(messageId: String, emoji: String, confirmedReacted: Bool) -> Bool? {
    if let index = intents.firstIndex(where: { $0.messageId == messageId && $0.emoji == emoji }) {
      intents[index].reacted.toggle()
      return nil
    }
    intents.append(.init(messageId: messageId, emoji: emoji, reacted: !confirmedReacted))
    return !confirmedReacted
  }

  /// After Core confirmed `sent`: the newer intent to send next, or nil when the last tap is confirmed.
  public func intent(messageId: String, emoji: String, after sent: Bool) -> Bool? {
    guard let latest = intent(messageId: messageId, emoji: emoji), latest != sent else { return nil }
    return latest
  }

  /// The request is over, confirmed or failed: the row shows its confirmed entry again.
  public mutating func settle(messageId: String, emoji: String) {
    intents.removeAll { $0.messageId == messageId && $0.emoji == emoji }
  }

  /// `message` with every intent for it on top of its confirmed entries.
  public func overlaying(_ message: Components.Schemas.ChatRoomMessage,
                         viewer: PendingReactionViewer) -> Components.Schemas.ChatRoomMessage {
    intents.reduce(message) { result, intent in
      intent.messageId == message.id ? applyingPendingReaction(intent, to: result, viewer: viewer) : result
    }
  }

  public func overlaying(_ messages: [Components.Schemas.ChatRoomMessage],
                         viewer: PendingReactionViewer) -> [Components.Schemas.ChatRoomMessage] {
    intents.isEmpty ? messages : messages.map { overlaying($0, viewer: viewer) }
  }
}

/// One intent over a confirmed message. A message that already matches the intent comes back unchanged.
func applyingPendingReaction(_ pending: PendingReaction, to message: Components.Schemas.ChatRoomMessage,
                             viewer: PendingReactionViewer) -> Components.Schemas.ChatRoomMessage {
  let index = message.reactions.firstIndex { $0.emoji == pending.emoji }
  let entry = index.map { message.reactions[$0] }
  guard (entry?.reactedByCurrentUser ?? false) != pending.reacted else { return message }
  var updated = message
  if pending.reacted {
    var next = entry ?? .init(emoji: pending.emoji, count: 0, reactedByCurrentUser: false, reactors: [])
    next.count += 1
    next.reactedByCurrentUser = true
    // Reactors are listed by reaction time and capped; a fresh tap is last.
    if let name = viewer.name, next.reactors.count < maxListedReactionReactors {
      next.reactors.append(.init(id: viewer.id, name: name))
    }
    if let index {
      updated.reactions[index] = next
    } else {
      updated.reactions.append(next)
    }
  } else if let index, var next = entry {
    next.count -= 1
    next.reactedByCurrentUser = false
    next.reactors.removeAll { $0.id == viewer.id }
    if next.count < 1 {
      updated.reactions.remove(at: index)
    } else {
      updated.reactions[index] = next
    }
  }
  return updated
}
