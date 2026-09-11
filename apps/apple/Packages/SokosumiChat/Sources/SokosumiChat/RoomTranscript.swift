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

  func markRoomUnread(
    client: Client,
    roomId: String,
    organizationSlug: String?
  ) async throws -> Components.Schemas.ChatRoom {
    let response = try await client.postChatsRoomsIdUnread(
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

  /// `POST /chats/rooms/{id}/messages` with `content` and a client turn id.
  /// Retry of a failed send reuses that id so Core keeps one row.
  func createMessage(
    client: Client,
    roomId: String,
    content: String,
    clientMessageId: String,
    parentMessageId: String? = nil,
    mentions: [ComposerMention] = [],
    organizationSlug: String?
  ) async throws -> Components.Schemas.ChatRoomMessage {
    let response = try await client.postChatsRoomsIdMessages(
      .init(
        path: .init(id: roomId),
        headers: .init(xOrganizationSlug: organizationSlug),
        body: .json(.init(content: content,
                          mentionedCoworkerIds: mentions.filter { $0.kind == .coworker }.map(\.id),
                          mentionedSokoBotIds: mentions.filter { $0.kind == .sokoBot }.map(\.id),
                          mentionedUserIds: mentions.filter { $0.kind == .human }.map(\.id),
                          parentMessageId: parentMessageId, clientMessageId: clientMessageId))
      )
    )
    switch response {
    case let .created(createdResponse):
      return try createdResponse.body.json.data
    case let .badRequest(badRequest):
      throw try ChatServiceError.unprocessable(statusCode: 400, message: badRequest.body.json.message)
    case let .unauthorized(unauthorized):
      throw try ChatServiceError.unauthorized(unauthorized.body.json.message)
    case let .forbidden(forbidden):
      throw try ChatServiceError.unprocessable(statusCode: 403, message: forbidden.body.json.message)
    case let .notFound(notFound):
      throw try ChatServiceError.unprocessable(statusCode: 404, message: notFound.body.json.message)
    case let .conflict(conflict):
      throw try ChatServiceError.unprocessable(statusCode: 409, message: conflict.body.json.message)
    case let .internalServerError(serverError):
      throw try ChatServiceError.unprocessable(statusCode: 500, message: serverError.body.json.message)
    case let .undocumented(statusCode, payload):
      throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
