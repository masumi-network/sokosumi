import CoreAPI

public extension ChatService {
  /// `GET /chats/rooms/{id}/messages/{messageId}/results`: the message's recorded results as this viewer may see
  /// them now, one per descriptor (web `AuthorizedResultPreviews` through `/api/chat/…/results`).
  func messageResults(client: Client, roomId: String, messageId: String, organizationSlug: String?) async throws -> [Components.Schemas.ChatResultPreview] {
    try await call {
      try await client.getChatRoomMessageResults(.init(
        path: .init(id: roomId, messageId: messageId),
        headers: .init(xOrganizationSlug: organizationSlug)
      ))
    }.ok.body.json.data
  }
}
