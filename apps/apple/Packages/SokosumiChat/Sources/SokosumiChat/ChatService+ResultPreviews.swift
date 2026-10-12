import CoreAPI

public extension ChatService {
  /// `GET /chats/rooms/{id}/messages/{messageId}/results`: the message's recorded results as this viewer may see
  /// them now, one per descriptor (web `AuthorizedResultPreviews` through `/api/chat/…/results`).
  func messageResults(client: Client, roomId: String, messageId: String, organizationSlug: String?) async throws -> [Components.Schemas.ChatResultPreview] {
    let response = try await client.getChatRoomMessageResults(.init(
      path: .init(id: roomId, messageId: messageId),
      headers: .init(xOrganizationSlug: organizationSlug)
    ))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .tooManyRequests(value): throw try rejected(status: 429, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
