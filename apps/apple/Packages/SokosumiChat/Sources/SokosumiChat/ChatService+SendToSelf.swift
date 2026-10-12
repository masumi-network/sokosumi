import CoreAPI

public extension ChatService {
  /// Send to yourself: Core quotes the message into the caller's Self Direct and returns the saved quote message.
  func sendMessageToSelf(client: Client, roomId: String, messageId: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomMessage {
    try await call { try await client.postChatsRoomsIdMessagesMessageIdSendToSelf(.init(path: .init(id: roomId, messageId: messageId), headers: .init(xOrganizationSlug: organizationSlug))) }.created.body.json.data
  }
}
