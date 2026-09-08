import CoreAPI
import Foundation
import OpenAPIRuntime

/// First-page size for room history. Matches web's `ROOM_MESSAGE_LIMIT` so
/// the Mac tracer pages the same transcript as the browser.
private let roomHistoryLimit = 100

/// Display name for a transcript row sender, mirroring `roomDisplayName`'s
/// human rule (name, else email). Plain text only — no mention chips.
public func messageSenderName(_ sender: Components.Schemas.ChatRoomMessageSender) -> String {
  switch sender {
  case let .case1(user):
    user.user.name.isEmpty ? user.user.email : user.user.name
  case let .case2(coworker):
    coworker.coworker.name
  case let .case3(bot):
    bot.sokoBot.name
  case .case4:
    "Unknown"
  }
}

public extension ChatService {
  /// One history page in reading order (oldest first). An empty room
  /// resolves empty — never an error. Nil slug omits the org header
  /// (personal); a slug sends `X-Organization-Slug`.
  func listMessages(
    client: Client,
    roomId: String,
    cursor: String? = nil,
    limit: Int? = nil,
    organizationSlug: String?
  ) async throws -> (messages: [Components.Schemas.ChatRoomMessage], nextCursor: String?) {
    let response = try await client.getChatsRoomsIdMessages(
      .init(
        path: .init(id: roomId),
        query: .init(cursor: cursor, limit: limit ?? roomHistoryLimit),
        headers: .init(xOrganizationSlug: organizationSlug)
      )
    )
    switch response {
    case let .ok(okResponse):
      let payload = try okResponse.body.json
      return (payload.data, payload.meta.pagination.nextCursor)
    case let .unauthorized(unauthorized):
      throw try ChatServiceError.unauthorized(unauthorized.body.json.message)
    case let .forbidden(forbidden):
      throw try ChatServiceError.unprocessable(statusCode: 403, message: forbidden.body.json.message)
    case let .notFound(notFound):
      throw try ChatServiceError.unprocessable(statusCode: 404, message: notFound.body.json.message)
    case let .unprocessableContent(invalid):
      throw try ChatServiceError.unprocessable(statusCode: 422, message: invalid.body.json.message)
    case let .internalServerError(serverError):
      throw try ChatServiceError.unprocessable(statusCode: 500, message: serverError.body.json.message)
    case let .undocumented(statusCode, payload):
      throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `POST /chats/rooms/{id}/read`. Returns the updated room DTO — the
  /// caller replaces its list entry so unread chrome matches Core.
  func markRoomRead(
    client: Client,
    roomId: String,
    organizationSlug: String?
  ) async throws -> Components.Schemas.ChatRoom {
    let response = try await client.postChatsRoomsIdRead(
      .init(
        path: .init(id: roomId),
        headers: .init(xOrganizationSlug: organizationSlug)
      )
    )
    switch response {
    case let .ok(okResponse):
      return try okResponse.body.json.data
    case let .unauthorized(unauthorized):
      throw try ChatServiceError.unauthorized(unauthorized.body.json.message)
    case let .forbidden(forbidden):
      throw try ChatServiceError.unprocessable(statusCode: 403, message: forbidden.body.json.message)
    case let .notFound(notFound):
      throw try ChatServiceError.unprocessable(statusCode: 404, message: notFound.body.json.message)
    case let .internalServerError(serverError):
      throw try ChatServiceError.unprocessable(statusCode: 500, message: serverError.body.json.message)
    case let .undocumented(statusCode, payload):
      throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
