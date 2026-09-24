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
  func openDirect(client: Client, selection: DirectConversationSelection, organizationSlug: String?) async throws -> Components.Schemas.ChatRoom {
    guard let first = selection.recipients.first else {
      throw ChatServiceError.unexpectedResponse("Choose a direct message target.")
    }
    var body = first.requestBody
    if case .human = first {
      guard selection.recipients.count == 1 || organizationSlug != nil else {
        throw ChatServiceError.unexpectedResponse("Select an organization to start a group Direct.")
      }
      body.memberUserIds = selection.recipients.compactMap {
        if case let .human(id) = $0 {
          return id
        }
        return nil
      }
    }
    return try await createRoom(client: client, body: .case2(body), organizationSlug: organizationSlug)
  }

  internal func createRoom(
    client: Client,
    body: Components.Schemas.CreateChatRoomRequest,
    organizationSlug: String?
  ) async throws -> Components.Schemas.ChatRoom {
    let response = try await client.postChatsRooms(.init(headers: .init(xOrganizationSlug: organizationSlug), body: .json(body)))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .created(value): return try value.body.json.data
    case let .badRequest(value): throw try rejected(status: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .conflict(value):
      let error = try value.body.json
      if case .case1 = body, error.kind == "channel_slug_taken" {
        throw ChannelCreationError.slugTaken
      }
      throw ChatServiceError.unprocessable(statusCode: 409, message: error.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
