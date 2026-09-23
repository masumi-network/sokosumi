import CoreAPI

public extension ChatService {
  func getThread(client: Client, roomId: String, parentMessageId: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomThread {
    let response = try await client.getChatsRoomsIdThreadsParentMessageId(.init(
      path: .init(id: roomId, parentMessageId: parentMessageId),
      headers: .init(xOrganizationSlug: organizationSlug)
    ))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .tooManyRequests(value): throw try ChatServiceError.unprocessable(statusCode: 429, message: value.body.json.message)
    case let .internalServerError(value): throw try ChatServiceError.unprocessable(statusCode: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// Core also Looks the thread and answers with it as the reader now sees it; 404 when the parent is not a thread.
  func muteThread(client: Client, roomId: String, parentMessageId: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomThread {
    let response = try await client.postChatsRoomsIdThreadsParentMessageIdMute(.init(
      path: .init(id: roomId, parentMessageId: parentMessageId),
      headers: .init(xOrganizationSlug: organizationSlug)
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

  func unmuteThread(client: Client, roomId: String, parentMessageId: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomThread {
    let response = try await client.deleteChatsRoomsIdThreadsParentMessageIdMute(.init(
      path: .init(id: roomId, parentMessageId: parentMessageId),
      headers: .init(xOrganizationSlug: organizationSlug)
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
