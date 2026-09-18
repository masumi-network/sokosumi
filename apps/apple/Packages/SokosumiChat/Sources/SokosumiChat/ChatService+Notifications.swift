import CoreAPI

/// The delivery half of `GET`/`PATCH /users/me/preferences`.
public struct NotificationPreferencesSnapshot: Equatable, Sendable {
  public var pushOptIn: Bool
  public var cells: [NotificationPreferenceCell]

  public init(pushOptIn: Bool, cells: [NotificationPreferenceCell]) {
    self.pushOptIn = pushOptIn
    self.cells = cells
  }
}

public extension ChatService {
  /// `GET /users/me/preferences`: the resolved notification matrix and the
  /// account-wide banner consent. User-scoped, so no organization header.
  func notificationPreferences(client: Client) async throws -> NotificationPreferencesSnapshot {
    let response = try await client.getUsersIdPreferences(.init(path: .init(id: "me")))
    switch response {
    case let .ok(value):
      let data = try value.body.json.data
      return .init(pushOptIn: data.pushOptIn, cells: data.notificationPreferences)
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try ChatServiceError.unprocessable(statusCode: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `PATCH /users/me/preferences` with the changed cells and, when it moves,
  /// the consent, in one transaction. Returns Core's stored answer.
  func updateNotificationPreferences(client: Client, pushOptIn: Bool?, cells: [NotificationPreferenceCell]) async throws -> NotificationPreferencesSnapshot {
    let response = try await client.patchUsersIdPreferences(.init(
      path: .init(id: "me"),
      body: .json(.init(pushOptIn: pushOptIn, notificationPreferences: cells))
    ))
    switch response {
    case let .ok(value):
      let data = try value.body.json.data
      return .init(pushOptIn: data.pushOptIn, cells: data.notificationPreferences)
    case let .badRequest(value): throw try ChatServiceError.unprocessable(statusCode: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `PATCH /notifications/{id}/read`. Core republishes a cleared room row, so
  /// the banner comes down on every device.
  func markNotificationRead(client: Client, id: String) async throws {
    let response = try await client.patchNotificationsIdRead(.init(path: .init(id: id)))
    switch response {
    case .ok: return
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try ChatServiceError.unprocessable(statusCode: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `GET /workspaces/{id}`: the organization behind a notification's
  /// workspace; nil is the personal workspace.
  func workspaceOrganizationId(client: Client, workspaceId: String) async throws -> String? {
    let response = try await client.getWorkspacesId(.init(path: .init(id: workspaceId)))
    switch response {
    case let .ok(value): return try value.body.json.data.organizationId
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
