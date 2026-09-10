import CoreAPI
import Foundation

/// High-frequency room events replace one field, never the whole message.
public struct RealtimeMessagePatch: Sendable {
  public enum Value: Sendable {
    case reactions([Components.Schemas.ChatRoomMessageReaction])
    case unfurls([Components.Schemas.ChatRoomMessageUnfurl]?)
    case mentions([Components.Schemas.ChatRoomMessageMention])
  }

  public let roomId: String
  public let messageId: String
  public let parentMessageId: String?
  public let value: Value

  public init(roomId: String, messageId: String, parentMessageId: String?, value: Value) {
    self.roomId = roomId
    self.messageId = messageId
    self.parentMessageId = parentMessageId
    self.value = value
  }
}

/// Missing IDs and replies stay absent from the room timeline. Reply routing
/// belongs to the thread slice; the field values use the generated Core DTOs.
public func applyRealtimePatch(
  _ patch: RealtimeMessagePatch,
  messages: [Components.Schemas.ChatRoomMessage]
) -> [Components.Schemas.ChatRoomMessage] {
  guard patch.parentMessageId == nil else { return messages }
  return messages.map { existing in
    guard existing.id == patch.messageId, existing.roomId == patch.roomId,
          existing.parentMessageId == nil else { return existing }
    var updated = existing
    switch patch.value {
    case let .reactions(values): updated.reactions = values
    case let .unfurls(values): updated.unfurls = values
    case let .mentions(values): updated.mentions = values
    }
    return updated
  }
}
