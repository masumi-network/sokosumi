import CoreAPI
import Foundation

public extension ChannelEditDraft {
  /// PATCH rewrites the whole host roster; web sends the three id lists on every save and
  /// the settings fields only when the caller may manage them (roster-only body otherwise).
  func updateRequest(permissions: ChannelEditPermissions, currentUserId: String) -> Components.Schemas.UpdateChatRoomRequest {
    var humans = Set([currentUserId])
    var coworkers = Set<String>()
    var assistants = Set<String>()
    for recipient in recipients {
      switch recipient {
      case let .human(id): humans.insert(id)
      case let .coworker(id): coworkers.insert(id)
      case let .sokoBot(id): assistants.insert(id)
      }
    }
    var body = Components.Schemas.UpdateChatRoomRequest(memberUserIds: humans.sorted(), coworkerIds: coworkers.sorted(), sokoBotIds: assistants.sorted())
    if permissions.canManageSettings {
      body.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
      body.topic = topic.trimmingCharacters(in: .whitespacesAndNewlines)
      body.discoverability = .init(rawValue: visibility.rawValue)
    }
    return body
  }
}

public extension ChatService {
  /// Channel settings and roster, or a group Direct's Group name; a personal workspace Direct omits the slug.
  func updateRoom(client: Client, roomId: String, request: Components.Schemas.UpdateChatRoomRequest, organizationSlug: String?) async throws -> Components.Schemas.ChatRoom {
    let response = try await client.patchChatsRoomsId(.init(path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug), body: .json(request)))
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
