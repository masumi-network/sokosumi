import CoreAPI
import Foundation

public extension ChatService {
  func listThreadMessages(
    client: Client, roomId: String, parentMessageId: String,
    cursor: String? = nil,
    organizationSlug: String?
  ) async throws -> (messages: [Components.Schemas.ChatRoomMessage], nextCursor: String?) {
    let response = try await client.getChatsRoomsIdThreadsParentMessageIdMessages(
      .init(path: .init(id: roomId, parentMessageId: parentMessageId),
            query: .init(cursor: cursor, limit: 100),
            headers: .init(xOrganizationSlug: organizationSlug))
    )
    switch response {
    case let .ok(value):
      let payload = try value.body.json
      return (payload.data, payload.meta.pagination.nextCursor)
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .unprocessableContent(value): throw try ChatServiceError.unprocessable(statusCode: 422, message: value.body.json.message)
    case let .internalServerError(value): throw try ChatServiceError.unprocessable(statusCode: 500, message: value.body.json.message)
    case let .undocumented(code, payload): throw await unprocessableError(statusCode: code, payload: payload)
    }
  }

  func markThreadRead(
    client: Client, roomId: String, parentMessageId: String,
    organizationSlug: String?
  ) async throws -> Components.Schemas.ChatRoomThreadReadState {
    let response = try await client.postChatsRoomsIdThreadsParentMessageIdRead(
      .init(path: .init(id: roomId, parentMessageId: parentMessageId),
            headers: .init(xOrganizationSlug: organizationSlug))
    )
    switch response {
    case let .ok(value):
      return try value.body.json.data
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try ChatServiceError.unprocessable(statusCode: 500, message: value.body.json.message)
    case let .undocumented(code, payload): throw await unprocessableError(statusCode: code, payload: payload)
    }
  }
}
