import CoreAPI

public extension ChatService {
  /// Core keeps pins left out of `roomIds` after the listed ones, ignores ids the caller has not starred,
  /// and answers every starred room with its new sort key.
  func reorderPinnedRooms(client: Client, roomIds: [String], organizationSlug: String?) async throws -> [Components.Schemas.StarredChatRoomOrder] {
    let response = try await client.putChatsRoomsStarred(.init(
      headers: .init(xOrganizationSlug: organizationSlug), body: .json(.init(roomIds: roomIds))
    ))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .unprocessableContent(value): throw try ChatServiceError.unprocessable(statusCode: 422, message: value.body.json.message)
    case let .internalServerError(value): throw try ChatServiceError.unprocessable(statusCode: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  func pinRoom(client: Client, roomId: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoom {
    let response = try await client.postChatsRoomsIdStar(.init(
      path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug)
    ))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .unprocessableContent(value): throw try ChatServiceError.unprocessable(statusCode: 422, message: value.body.json.message)
    case let .internalServerError(value): throw try ChatServiceError.unprocessable(statusCode: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  func unpinRoom(client: Client, roomId: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoom {
    let response = try await client.deleteChatsRoomsIdStar(.init(
      path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug)
    ))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try ChatServiceError.unprocessable(statusCode: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  func muteRoom(client: Client, roomId: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoom {
    let response = try await client.postChatsRoomsIdMute(.init(
      path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug)
    ))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .unprocessableContent(value): throw try ChatServiceError.unprocessable(statusCode: 422, message: value.body.json.message)
    case let .internalServerError(value): throw try ChatServiceError.unprocessable(statusCode: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  func unmuteRoom(client: Client, roomId: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoom {
    let response = try await client.deleteChatsRoomsIdMute(.init(
      path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug)
    ))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try ChatServiceError.unprocessable(statusCode: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
