import CoreAPI

public extension ChatService {
  /// `PATCH /notifications/{id}/read`. Core republishes a cleared room row, so
  /// the banner comes down on every device.
  func markNotificationRead(client: Client, id: String) async throws {
    let response = try await client.patchNotificationsIdRead(.init(path: .init(id: id)))
    switch response {
    case .ok: return
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `GET /workspaces/{id}`: the organization behind a notification's
  /// workspace; nil is the personal workspace.
  func workspaceOrganizationId(client: Client, workspaceId: String) async throws -> String? {
    let response = try await client.getWorkspacesId(.init(path: .init(id: workspaceId)))
    switch response {
    case let .ok(value): return try value.body.json.data.organizationId
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
