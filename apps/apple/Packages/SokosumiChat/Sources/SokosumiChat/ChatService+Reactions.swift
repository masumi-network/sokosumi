import CoreAPI

public extension ChatService {
  /// Give the current user `emoji` on the message. Repeating it changes nothing
  /// on the server (ADR 0032), so a retry cannot flip the Reaction back.
  func addReaction(client: Client, roomId: String, messageId: String, emoji: String,
                   organizationSlug: String?) async throws -> Components.Schemas.ChatRoomMessage {
    let response = try await client.putChatsRoomsIdMessagesMessageIdReactionsEmoji(.init(
      path: .init(id: roomId, messageId: messageId, emoji: emoji),
      headers: .init(xOrganizationSlug: organizationSlug)
    ))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .badRequest(value): throw try rejected(status: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .unprocessableContent(value): throw try rejected(status: 422, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// Take the current user's `emoji` off the message. Idempotent like `addReaction`.
  func removeReaction(client: Client, roomId: String, messageId: String, emoji: String,
                      organizationSlug: String?) async throws -> Components.Schemas.ChatRoomMessage {
    let response = try await client.deleteChatsRoomsIdMessagesMessageIdReactionsEmoji(.init(
      path: .init(id: roomId, messageId: messageId, emoji: emoji),
      headers: .init(xOrganizationSlug: organizationSlug)
    ))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .badRequest(value): throw try rejected(status: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .unprocessableContent(value): throw try rejected(status: 422, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
