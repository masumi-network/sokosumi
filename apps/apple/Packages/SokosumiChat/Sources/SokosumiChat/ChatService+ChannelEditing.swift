import CoreAPI
import Foundation

public extension ChannelEditDraft {
  /// PATCH carries the settings only; membership changes go through the members endpoints (SOK-1258).
  var updateRequest: Components.Schemas.UpdateChatRoomRequest {
    .init(
      name: name.trimmingCharacters(in: .whitespacesAndNewlines),
      topic: topic.trimmingCharacters(in: .whitespacesAndNewlines),
      discoverability: .init(rawValue: visibility.rawValue)
    )
  }
}

public extension ChatService {
  /// Channel settings, or a group Direct's Group name; a personal workspace Direct omits the slug.
  func updateRoom(client: Client, roomId: String, request: Components.Schemas.UpdateChatRoomRequest, organizationSlug: String?) async throws -> Components.Schemas.ChatRoom {
    let response = try await client.patchChatsRoomsId(.init(path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug), body: .json(request)))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .badRequest(value): throw try rejected(status: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .conflict(value): throw try ChatServiceError.unprocessable(statusCode: 409, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
