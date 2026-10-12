import CoreAPI

public extension ChatService {
  func removeUnfurl(client: Client, roomId: String, messageId: String, url: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomMessage {
    try await call {
      try await client.postChatsRoomsIdMessagesMessageIdUnfurlsRemove(.init(
        path: .init(id: roomId, messageId: messageId), headers: .init(xOrganizationSlug: organizationSlug),
        body: .json(.init(url: url))
      ))
    }.ok.body.json.data
  }
}
