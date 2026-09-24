import CoreAPI

public extension ChatService {
  /// Send to yourself: Core quotes the message into the caller's Self Direct and returns the saved quote message.
  func sendMessageToSelf(client: Client, roomId: String, messageId: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomMessage {
    let response = try await client.postChatsRoomsIdMessagesMessageIdSendToSelf(.init(path: .init(id: roomId, messageId: messageId), headers: .init(xOrganizationSlug: organizationSlug)))
    switch response {
    case let .created(value): return try value.body.json.data
    case let .badRequest(value): throw try rejected(status: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
