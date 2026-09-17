import CoreAPI

/// Pins reuse this rule. A thinking coworker shell has no actions (web `showActions`).
public func canReactToMessage(_ message: Components.Schemas.ChatRoomMessage) -> Bool {
  message.deletedAt == nil && message.membership == nil
    && !isOutboundLocalMessage(message) && !message.id.hasPrefix("stream:")
    && CoworkerMentionShell(message: message)?.isThinking != true
}

/// Toggle responses contain a snapshot of every emoji. Preserve unrelated newer reactions.
public func applyingReactionResponse(_ response: Components.Schemas.ChatRoomMessage, emoji: String,
                                     to message: Components.Schemas.ChatRoomMessage) -> Components.Schemas.ChatRoomMessage {
  guard message.id == response.id, message.roomId == response.roomId,
        message.parentMessageId == response.parentMessageId, message.deletedAt == nil else { return message }
  var updated = message
  if let reaction = response.reactions.first(where: { $0.emoji == emoji }) {
    if let index = updated.reactions.firstIndex(where: { $0.emoji == emoji }) {
      updated.reactions[index] = reaction
    } else {
      updated.reactions.append(reaction)
    }
  } else {
    updated.reactions.removeAll { $0.emoji == emoji }
  }
  return updated
}
