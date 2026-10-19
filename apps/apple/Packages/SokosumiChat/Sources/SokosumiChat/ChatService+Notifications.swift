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
}
