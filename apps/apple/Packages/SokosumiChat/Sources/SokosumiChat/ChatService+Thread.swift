import CoreAPI

public extension ChatService {
  func getThread(client: Client, roomId: String, parentMessageId: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomThread {
    try await call {
      try await client.getChatsRoomsIdThreadsParentMessageId(.init(
        path: .init(id: roomId, parentMessageId: parentMessageId),
        headers: .init(xOrganizationSlug: organizationSlug)
      ))
    }.ok.body.json.data
  }

  /// Core also Looks the thread and answers with it as the reader now sees it; 404 when the parent is not a thread.
  func muteThread(client: Client, roomId: String, parentMessageId: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomThread {
    try await call {
      try await client.postChatsRoomsIdThreadsParentMessageIdMute(.init(
        path: .init(id: roomId, parentMessageId: parentMessageId),
        headers: .init(xOrganizationSlug: organizationSlug)
      ))
    }.ok.body.json.data
  }

  func unmuteThread(client: Client, roomId: String, parentMessageId: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomThread {
    try await call {
      try await client.deleteChatsRoomsIdThreadsParentMessageIdMute(.init(
        path: .init(id: roomId, parentMessageId: parentMessageId),
        headers: .init(xOrganizationSlug: organizationSlug)
      ))
    }.ok.body.json.data
  }
}
