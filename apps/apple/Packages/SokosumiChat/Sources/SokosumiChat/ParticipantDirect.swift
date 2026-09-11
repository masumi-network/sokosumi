import CoreAPI
import Foundation

/// A single participant target; mixed rosters and synthetic @all are not Direct targets.
public enum DirectRecipient: Hashable, Sendable {
  case human(String)
  case coworker(String)
  case sokoBot(String)

  public func canOpen(from room: Components.Schemas.ChatRoom, currentUserId: String, hasActiveOrganization: Bool) -> Bool {
    switch self {
    case let .human(id):
      let eligible = (room.kind == .channel && room.discoverability == .external)
        || (hasActiveOrganization && room.myAccess != .guest)
      return id != currentUserId && eligible && room.userMembers.contains { $0.id == id }
    case let .coworker(id): return room.coworkerMembers.contains { $0.id == id }
    case let .sokoBot(id): return room.sokoBotMembers.contains { $0.id == id }
    }
  }

  fileprivate var requestBody: Components.Schemas.CreateChatRoomRequest.Case2Payload {
    var body = Components.Schemas.CreateChatRoomRequest.Case2Payload(kind: .direct)
    switch self {
    case let .human(id): body.memberUserIds = [id]
    case let .coworker(id): body.coworkerIds = [id]
    case let .sokoBot(id): body.sokoBotIds = [id]
    }
    return body
  }
}

public extension ChatService {
  /// Core creates the Direct or returns the existing room. Eligibility remains server-owned.
  func openDirect(client: Client, recipient: DirectRecipient, organizationSlug: String?) async throws -> Components.Schemas.ChatRoom {
    let response = try await client.postChatsRooms(.init(headers: .init(xOrganizationSlug: organizationSlug), body: .json(.case2(recipient.requestBody))))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .created(value): return try value.body.json.data
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
