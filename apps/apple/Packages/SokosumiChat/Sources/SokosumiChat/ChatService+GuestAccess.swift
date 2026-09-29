import CoreAPI
import Foundation

/// Host-side guest calls. Core owns the host-member, external-channel, rate-limit and
/// guest-only rules; its messages surface as-is. These are host channel operations, so the organization header is
/// always sent.
public extension ChatService {
  /// `GET /chats/rooms/{id}/invitations`: live pending invitations, newest first.
  func roomInvitations(client: Client, roomId: String, organizationSlug: String) async throws -> [Components.Schemas.ChatRoomInvitation] {
    let response = try await client.getChatsRoomsIdInvitations(.init(path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug)))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `POST /chats/rooms/{id}/invitations`: Core normalizes the address, refuses host members and duplicates (409) and
  /// rate-limits (429), then emails the invitee.
  func inviteGuest(client: Client, roomId: String, email: String, organizationSlug: String) async throws -> Components.Schemas.ChatRoomInvitation {
    let response = try await client.postChatsRoomsIdInvitations(.init(
      path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug), body: .json(.init(email: email))
    ))
    switch response {
    case let .created(value): return try value.body.json.data
    case let .badRequest(value): throw try rejected(status: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .conflict(value): throw try ChatServiceError.unprocessable(statusCode: 409, message: value.body.json.message)
    case let .tooManyRequests(value): throw try rejected(status: 429, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `DELETE /chats/rooms/{id}/invitations/{invitationId}`: only pending invitations revoke; others answer 404.
  func revokeInvitation(client: Client, roomId: String, invitationId: String, organizationSlug: String) async throws {
    let response = try await client.deleteChatsRoomsIdInvitationsInvitationId(.init(
      path: .init(id: roomId, invitationId: invitationId), headers: .init(xOrganizationSlug: organizationSlug)
    ))
    switch response {
    case .noContent: return
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `GET /chats/rooms/{id}/invite-links`: every link including revoked, expired and depleted ones, newest first.
  func guestInviteLinks(client: Client, roomId: String, organizationSlug: String) async throws -> [Components.Schemas.ChatRoomGuestInviteLink] {
    let response = try await client.getChatsRoomsIdInviteLinks(.init(path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug)))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `POST /chats/rooms/{id}/invite-links`: `maxUses` nil means unlimited; the expiry travels through
  /// `GuestInviteLinkExpiryMiddleware` because the generated body cannot carry `expiresInDays`.
  func createGuestInviteLink(client: Client, roomId: String, options: GuestInviteLinkOptions, organizationSlug: String) async throws -> Components.Schemas.ChatRoomGuestInviteLink {
    let expiry: GuestInviteLinkExpiryMiddleware.Expiry = options.expiresInDays.map { .days($0) } ?? .never
    let response = try await GuestInviteLinkExpiryMiddleware.$expiry.withValue(expiry) {
      try await client.postChatsRoomsIdInviteLinks(.init(
        path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug), body: .json(.init(maxUses: options.maxUses))
      ))
    }
    switch response {
    case let .created(value): return try value.body.json.data
    case let .badRequest(value): throw try rejected(status: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .tooManyRequests(value): throw try rejected(status: 429, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `DELETE /chats/rooms/{id}/invite-links/{token}`.
  func revokeGuestInviteLink(client: Client, roomId: String, token: String, organizationSlug: String) async throws {
    let response = try await client.deleteChatsRoomsIdInviteLinksToken(.init(
      path: .init(id: roomId, token: token), headers: .init(xOrganizationSlug: organizationSlug)
    ))
    switch response {
    case .ok: return
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `DELETE /chats/rooms/{id}/members/{userId}`: guests only; host members leave through `members/me`.
  func removeGuest(client: Client, roomId: String, userId: String, organizationSlug: String) async throws {
    let response = try await client.deleteChatsRoomsIdMembersUserId(.init(
      path: .init(id: roomId, userId: userId), headers: .init(xOrganizationSlug: organizationSlug)
    ))
    switch response {
    case .ok: return
    case let .badRequest(value): throw try rejected(status: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
