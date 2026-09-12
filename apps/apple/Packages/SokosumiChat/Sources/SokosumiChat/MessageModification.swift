import CoreAPI

public func canModifyOwnMessage(_ message: Components.Schemas.ChatRoomMessage, userId: String) -> Bool {
  guard !userId.isEmpty, case let .case1(sender) = message.sender else { return false }
  return sender.user.id == userId && message.deletedAt == nil && message.membership == nil
    && !isOutboundLocalMessage(message) && !message.id.hasPrefix("stream:")
}

/// Core also republishes the parent. Do not decrement a count already updated by realtime.
public func applyingReplyDeletion(to parent: Components.Schemas.ChatRoomMessage, parentId: String, previousReplyCount: Int) -> Components.Schemas.ChatRoomMessage {
  guard parent.id == parentId, parent.threadReplyCount == previousReplyCount else { return parent }
  var updated = parent
  updated.threadReplyCount = max(0, previousReplyCount - 1)
  if updated.threadReplyCount == 0 {
    updated.threadLastReplyAt = nil
  }
  return updated
}
