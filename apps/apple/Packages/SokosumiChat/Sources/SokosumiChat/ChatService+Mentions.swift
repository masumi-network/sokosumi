import CoreAPI

public extension ChatService {
  /// `POST /chats/rooms/{id}/messages/{messageId}/mentions/{mentionId}/retry`:
  /// resets a failed mention to pending and dispatches it again. Returns the
  /// source human message; the coworker shell's live state arrives over realtime.
  /// 403 = not the author, 404 = unknown mention, 409 = mention is not failed.
  func retryMention(client: Client, roomId: String, messageId: String, mentionId: String,
                    organizationSlug: String?) async throws -> Components.Schemas.ChatRoomMessage {
    try await call {
      try await client.postChatsRoomsIdMessagesMessageIdMentionsMentionIdRetry(.init(
        path: .init(id: roomId, messageId: messageId, mentionId: mentionId),
        headers: .init(xOrganizationSlug: organizationSlug)
      ))
    }.ok.body.json.data
  }
}
