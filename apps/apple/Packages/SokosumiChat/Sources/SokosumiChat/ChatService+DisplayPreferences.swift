import CoreAPI

public extension ChatService {
  /// `GET /users/me/preferences`: the reader's opt-in Room unread count.
  /// User-scoped, so the operation carries no organization header.
  func showRoomUnreadCount(client: Client) async throws -> Bool {
    let response = try await client.getUsersIdPreferences(.init(path: .init(id: "me")))
    switch response {
    case let .ok(value): return try value.body.json.data.showRoomUnreadCount
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try ChatServiceError.unprocessable(statusCode: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `PATCH /users/me/preferences` with only `showRoomUnreadCount`, the column
  /// web writes through Better Auth `updateUser`. Returns the stored value.
  func updateShowRoomUnreadCount(client: Client, enabled: Bool) async throws -> Bool {
    let response = try await client.patchUsersIdPreferences(.init(
      path: .init(id: "me"),
      body: .json(.init(showRoomUnreadCount: enabled))
    ))
    switch response {
    case let .ok(value): return try value.body.json.data.showRoomUnreadCount
    case let .badRequest(value): throw try ChatServiceError.unprocessable(statusCode: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
