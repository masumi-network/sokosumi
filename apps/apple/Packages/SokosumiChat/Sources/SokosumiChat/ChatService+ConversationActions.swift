import CoreAPI

public extension ChatService {
  /// Core keeps pins left out of `roomIds` after the listed ones, ignores ids the caller has not starred,
  /// and answers every starred room with its new sort key.
  func reorderPinnedRooms(client: Client, roomIds: [String], organizationSlug: String?) async throws -> [Components.Schemas.StarredChatRoomOrder] {
    try await call {
      try await client.putChatsRoomsStarred(.init(
        headers: .init(xOrganizationSlug: organizationSlug), body: .json(.init(roomIds: roomIds))
      ))
    }.ok.body.json.data
  }

  func pinRoom(client: Client, roomId: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoom {
    try await call {
      try await client.postChatsRoomsIdStar(.init(
        path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug)
      ))
    }.ok.body.json.data
  }

  func unpinRoom(client: Client, roomId: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoom {
    try await call {
      try await client.deleteChatsRoomsIdStar(.init(
        path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug)
      ))
    }.ok.body.json.data
  }

  func muteRoom(client: Client, roomId: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoom {
    try await call {
      try await client.postChatsRoomsIdMute(.init(
        path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug)
      ))
    }.ok.body.json.data
  }

  func unmuteRoom(client: Client, roomId: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoom {
    try await call {
      try await client.deleteChatsRoomsIdMute(.init(
        path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug)
      ))
    }.ok.body.json.data
  }
}
