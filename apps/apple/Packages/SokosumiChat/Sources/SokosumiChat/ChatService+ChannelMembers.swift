import CoreAPI
import Foundation

/// Incremental Channel membership (SOK-1258). Core owns the permission matrix and the Soko Bot cascade; its messages
/// surface as-is. These are organization Channel operations, so the organization header is always sent.
public extension ChatService {
  /// `POST /chats/rooms/{id}/members`: adds without removing; members already present are no-ops.
  func addChannelMembers(client: Client, roomId: String, recipients: Set<DirectRecipient>, organizationSlug: String) async throws -> Components.Schemas.ChatRoom {
    let response = try await client.postChatsRoomsIdMembers(.init(
      path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug), body: .json(addMembersRequest(recipients))
    ))
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

  /// `DELETE /chats/rooms/{id}/members/{userId}`: a Guest for any host member, a host member for an owner or admin.
  /// Their Soko Bots leave with them. Leaving yourself goes through `members/me`.
  func removeMember(client: Client, roomId: String, userId: String, organizationSlug: String) async throws {
    let response = try await client.deleteChatsRoomsIdMembersUserId(.init(
      path: .init(id: roomId, userId: userId), headers: .init(xOrganizationSlug: organizationSlug)
    ))
    switch response {
    case .ok: return
    case let .badRequest(value): throw try rejected(status: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .conflict(value): throw try ChatServiceError.unprocessable(statusCode: 409, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `DELETE /chats/rooms/{id}/coworkers/{coworkerId}`: any host member.
  func removeCoworker(client: Client, roomId: String, coworkerId: String, organizationSlug: String) async throws -> Components.Schemas.ChatRoom {
    let response = try await client.deleteChatsRoomsIdCoworkersCoworkerId(.init(
      path: .init(id: roomId, coworkerId: coworkerId), headers: .init(xOrganizationSlug: organizationSlug)
    ))
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

  /// `DELETE /chats/rooms/{id}/soko-bots/{sokoBotId}`: its owner only.
  func removeSokoBot(client: Client, roomId: String, sokoBotId: String, organizationSlug: String) async throws -> Components.Schemas.ChatRoom {
    let response = try await client.deleteChatsRoomsIdSokoBotsSokoBotId(.init(
      path: .init(id: roomId, sokoBotId: sokoBotId), headers: .init(xOrganizationSlug: organizationSlug)
    ))
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

  /// One sorted id list per kind; a kind with nobody to add is left out of the body.
  private func addMembersRequest(_ recipients: Set<DirectRecipient>) -> Components.Schemas.AddChatRoomMembersRequest {
    var userIds: [String] = []
    var coworkerIds: [String] = []
    var sokoBotIds: [String] = []
    for recipient in recipients {
      switch recipient {
      case let .human(id): userIds.append(id)
      case let .coworker(id): coworkerIds.append(id)
      case let .sokoBot(id): sokoBotIds.append(id)
      }
    }
    return .init(
      userIds: userIds.isEmpty ? nil : userIds.sorted(),
      coworkerIds: coworkerIds.isEmpty ? nil : coworkerIds.sorted(),
      sokoBotIds: sokoBotIds.isEmpty ? nil : sokoBotIds.sorted()
    )
  }
}
