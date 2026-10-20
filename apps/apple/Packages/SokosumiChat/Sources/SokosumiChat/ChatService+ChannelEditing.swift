import CoreAPI
import Foundation

public extension ChannelEditDraft {
  /// PATCH carries the settings only; membership changes go through the members endpoints (SOK-1258).
  var updateRequest: Components.Schemas.UpdateChatRoomRequest {
    .init(
      name: name.trimmingCharacters(in: .whitespacesAndNewlines),
      topic: topic.trimmingCharacters(in: .whitespacesAndNewlines),
      discoverability: .init(rawValue: visibility.rawValue)
    )
  }
}

public extension ChatService {
  /// Channel settings, or a group Direct's Group name; a personal workspace Direct omits the slug.
  func updateRoom(client: Client, roomId: String, request: Components.Schemas.UpdateChatRoomRequest, organizationSlug: String?) async throws -> Components.Schemas.ChatRoom {
    try await call { try await client.patchChatsRoomsId(.init(path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug), body: .json(request))) }.ok.body.json.data
  }
}
