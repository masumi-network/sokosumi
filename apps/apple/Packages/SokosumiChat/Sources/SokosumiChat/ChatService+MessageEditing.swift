import CoreAPI

public extension ChatService {
  func editMessage(client: Client, roomId: String, messageId: String, content: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomMessage {
    let response = try await client.patchChatsRoomsIdMessagesMessageId(.init(
      path: .init(id: roomId, messageId: messageId), headers: .init(xOrganizationSlug: organizationSlug),
      body: .json(.init(content: content))
    ))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .badRequest(value): throw try ChatServiceError.unprocessable(statusCode: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try ChatServiceError.unprocessable(statusCode: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
