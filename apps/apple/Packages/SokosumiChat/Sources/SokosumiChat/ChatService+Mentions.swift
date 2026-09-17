import CoreAPI

public extension ChatService {
  /// `POST /chats/rooms/{id}/messages/{messageId}/mentions/{mentionId}/retry`:
  /// resets a failed mention to pending and dispatches it again. Returns the
  /// source human message; the coworker shell's live state arrives over realtime.
  /// 403 = not the author, 404 = unknown mention, 409 = mention is not failed.
  func retryMention(client: Client, roomId: String, messageId: String, mentionId: String,
                    organizationSlug: String?) async throws -> Components.Schemas.ChatRoomMessage {
    let response = try await client.postChatsRoomsIdMessagesMessageIdMentionsMentionIdRetry(.init(
      path: .init(id: roomId, messageId: messageId, mentionId: mentionId),
      headers: .init(xOrganizationSlug: organizationSlug)
    ))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .badRequest(value): throw try ChatServiceError.unprocessable(statusCode: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .conflict(value): throw try ChatServiceError.unprocessable(statusCode: 409, message: value.body.json.message)
    case let .internalServerError(value): throw try ChatServiceError.unprocessable(statusCode: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
