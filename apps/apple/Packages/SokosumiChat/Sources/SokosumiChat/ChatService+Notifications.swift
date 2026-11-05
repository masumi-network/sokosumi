import CoreAPI

public extension ChatService {
  /// `PATCH /notifications/{id}/read`. Core republishes a cleared room row, so
  /// the banner comes down on every device.
  func markNotificationRead(client: Client, id: String) async throws {
    _ = try await call { try await client.patchNotificationsIdRead(.init(path: .init(id: id))) }.ok
  }

  /// `GET /workspaces/{id}`: the organization behind a notification's
  /// workspace; nil is the personal workspace.
  func workspaceOrganizationId(client: Client, workspaceId: String) async throws -> String? {
    try await call { try await client.getWorkspacesId(.init(path: .init(id: workspaceId))) }.ok.body.json.data.organizationId
  }

  /// `GET /chats/rooms/{id}`: a notification's room the room list does not show yet, read for its workspace scope.
  func room(client: Client, roomId: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoom {
    try await call {
      try await client.getChatsRoomsId(.init(path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug)))
    }.ok.body.json.data
  }
}
