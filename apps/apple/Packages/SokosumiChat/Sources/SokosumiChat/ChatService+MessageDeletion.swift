import CoreAPI

public extension ChatService {
  func deleteMessage(client: Client, roomId: String, messageId: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomMessage {
    try await call {
      try await client.deleteChatsRoomsIdMessagesMessageId(.init(
        path: .init(id: roomId, messageId: messageId), headers: .init(xOrganizationSlug: organizationSlug)
      ))
    }.ok.body.json.data
  }
}
