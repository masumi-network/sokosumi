import CoreAPI

/// The account preferences both chat models read: unread-count display and
/// the notification matrix. User-scoped, so GET/PATCH carry no organization
/// header. Callers stay split and project the fields they own.
struct UserPreferencesSnapshot: Equatable, Sendable {
  var showRoomUnreadCount: Bool
  var pushOptIn: Bool
  var cells: [Components.Schemas.NotificationPreference]
}

extension ChatService {
  /// `GET /users/me/preferences`.
  func userPreferences(client: Client) async throws -> UserPreferencesSnapshot {
    let response = try await client.getUsersIdPreferences(.init(path: .init(id: "me")))
    switch response {
    case let .ok(value):
      let data = try value.body.json.data
      return .init(
        showRoomUnreadCount: data.showRoomUnreadCount,
        pushOptIn: data.pushOptIn,
        cells: data.notificationPreferences
      )
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `PATCH /users/me/preferences` with only the fields the caller changed.
  /// Nil fields stay omitted so a display write cannot clobber the matrix.
  func updateUserPreferences(
    client: Client,
    showRoomUnreadCount: Bool? = nil,
    pushOptIn: Bool? = nil,
    notificationPreferences: [Components.Schemas.NotificationPreference]? = nil
  ) async throws -> UserPreferencesSnapshot {
    let response = try await client.patchUsersIdPreferences(.init(
      path: .init(id: "me"),
      body: .json(.init(
        pushOptIn: pushOptIn,
        showRoomUnreadCount: showRoomUnreadCount,
        notificationPreferences: notificationPreferences
      ))
    ))
    switch response {
    case let .ok(value):
      let data = try value.body.json.data
      return .init(
        showRoomUnreadCount: data.showRoomUnreadCount,
        pushOptIn: data.pushOptIn,
        cells: data.notificationPreferences
      )
    case let .badRequest(value): throw try rejected(status: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
