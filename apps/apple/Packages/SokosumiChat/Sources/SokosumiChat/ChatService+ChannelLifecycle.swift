import CoreAPI
import Foundation

/// Web `chat-room.service.ts` lifecycle calls. Core owns every role, membership and last-member rule; its messages surface as-is.
public extension ChatService {
  /// `DELETE /chats/rooms/{id}/members/me`. Guest and matched rooms can be left from a personal workspace, so the header stays optional.
  func leaveChannel(client: Client, roomId: String, organizationSlug: String?) async throws {
    let response = try await client.deleteChatsRoomsIdMembersMe(.init(path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug)))
    switch response {
    case .ok: return
    case let .badRequest(value): throw try ChatServiceError.unprocessable(statusCode: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try ChatServiceError.unprocessable(statusCode: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `POST /chats/rooms/{id}/archive`.
  func archiveChannel(client: Client, roomId: String, organizationSlug: String) async throws {
    let response = try await client.postChatsRoomsIdArchive(.init(path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug)))
    switch response {
    case .ok: return
    case let .badRequest(value): throw try ChatServiceError.unprocessable(statusCode: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try ChatServiceError.unprocessable(statusCode: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `POST /chats/rooms/{id}/restore`; returns the live room DTO.
  func restoreChannel(client: Client, roomId: String, organizationSlug: String) async throws -> Components.Schemas.ChatRoom {
    let response = try await client.postChatsRoomsIdRestore(.init(path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug)))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .badRequest(value): throw try ChatServiceError.unprocessable(statusCode: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try ChatServiceError.unprocessable(statusCode: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `DELETE /chats/rooms/{id}`: permanent, archived channels only.
  func deleteChannel(client: Client, roomId: String, organizationSlug: String) async throws {
    let response = try await client.deleteChatsRoomsId(.init(path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug)))
    switch response {
    case .noContent: return
    case let .badRequest(value): throw try ChatServiceError.unprocessable(statusCode: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try ChatServiceError.unprocessable(statusCode: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// Web `listArchivedRooms` plus the owner/admin flag that enables Delete.
  func archivedChannels(client: Client, organizationId: String, organizationSlug: String) async throws -> ArchivedChannelList {
    let canDelete = try await isOrganizationOwnerOrAdmin(client: client, organizationId: organizationId)
    let rooms = try await listRooms(client: client, organizationSlug: organizationSlug, kind: .channel, status: .archived)
    return ArchivedChannelList(rooms: rooms, canDelete: canDelete)
  }
}
