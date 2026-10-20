import CoreAPI

public extension ChatService {
  /// Give the current user `emoji` on the message. Repeating it changes nothing
  /// on the server (ADR 0032), so a retry cannot flip the Reaction back.
  func addReaction(client: Client, roomId: String, messageId: String, emoji: String,
                   organizationSlug: String?) async throws -> Components.Schemas.ChatRoomMessage {
    try await call {
      try await client.putChatsRoomsIdMessagesMessageIdReactionsEmoji(.init(
        path: .init(id: roomId, messageId: messageId, emoji: emoji),
        headers: .init(xOrganizationSlug: organizationSlug)
      ))
    }.ok.body.json.data
  }

  /// Take the current user's `emoji` off the message. Idempotent like `addReaction`.
  func removeReaction(client: Client, roomId: String, messageId: String, emoji: String,
                      organizationSlug: String?) async throws -> Components.Schemas.ChatRoomMessage {
    try await call {
      try await client.deleteChatsRoomsIdMessagesMessageIdReactionsEmoji(.init(
        path: .init(id: roomId, messageId: messageId, emoji: emoji),
        headers: .init(xOrganizationSlug: organizationSlug)
      ))
    }.ok.body.json.data
  }
}
