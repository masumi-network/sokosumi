import CoreAPI

public extension ChatService {
  func listPinnedMessages(client: Client, roomId: String, cursor: String? = nil, organizationSlug: String?) async throws -> (items: [Components.Schemas.ChatRoomPinnedMessageListItem], nextCursor: String?) {
    let value = try await call { try await client.getChatsRoomsIdPinnedMessages(.init(path: .init(id: roomId), query: .init(cursor: cursor), headers: .init(xOrganizationSlug: organizationSlug))) }.ok
    let payload = try value.body.json
    return (payload.data, payload.meta.pagination.nextCursor)
  }

  func pinMessage(client: Client, roomId: String, messageId: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomPinnedMessageMutation {
    try await call { try await client.postChatsRoomsIdMessagesMessageIdPin(.init(path: .init(id: roomId, messageId: messageId), headers: .init(xOrganizationSlug: organizationSlug))) }.ok.body.json.data
  }

  func unpinMessage(client: Client, roomId: String, messageId: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomPinnedMessageMutation {
    try await call { try await client.deleteChatsRoomsIdMessagesMessageIdPin(.init(path: .init(id: roomId, messageId: messageId), headers: .init(xOrganizationSlug: organizationSlug))) }.ok.body.json.data
  }
}
