import CoreAPI

public extension ChatService {
  func editMessage(client: Client, roomId: String, messageId: String, content: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomMessage {
    try await call {
      try await client.patchChatsRoomsIdMessagesMessageId(.init(
        path: .init(id: roomId, messageId: messageId), headers: .init(xOrganizationSlug: organizationSlug),
        body: .json(.init(content: content))
      ))
    }.ok.body.json.data
  }
}
