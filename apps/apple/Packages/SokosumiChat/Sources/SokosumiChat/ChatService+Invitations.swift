import CoreAPI
import Foundation

/// Invitee and guest-link calls. Core matches the invitee email, expires invites, checks link
/// usage and host membership; its messages surface as-is. Personal workspaces omit the organization header.
public extension ChatService {
  /// `GET /chats/invitations?status=pending`: the External sidebar list, already excluding expired invites.
  func pendingInvitations(client: Client, organizationSlug: String?) async throws -> [Components.Schemas.ChatRoomInvitation] {
    let response = try await client.getChatsInvitations(.init(
      query: .init(status: .init(value1: .pending, value2: .init(unvalidatedValue: "pending"))),
      headers: .init(xOrganizationSlug: organizationSlug)
    ))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `GET /chats/invitations/{id}`: the invite page. Core answers 404 for another invitee's invitation.
  func invitation(client: Client, id: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomInvitation {
    let response = try await client.getChatsInvitationsId(.init(path: .init(id: id), headers: .init(xOrganizationSlug: organizationSlug)))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `POST /chats/invitations/{id}/accept`: joins the channel as a guest; the room itself comes from the next room list.
  func acceptInvitation(client: Client, id: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomInvitation {
    let response = try await client.postChatsInvitationsIdAccept(.init(path: .init(id: id), headers: .init(xOrganizationSlug: organizationSlug)))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .badRequest(value): throw try rejected(status: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `POST /chats/invitations/{id}/decline`.
  func declineInvitation(client: Client, id: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomInvitation {
    let response = try await client.postChatsInvitationsIdDecline(.init(path: .init(id: id), headers: .init(xOrganizationSlug: organizationSlug)))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .badRequest(value): throw try rejected(status: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `GET /chat-room-invite-links/{token}`: the `/chat/join` preview. The token is the capability, so invalid tokens
  /// answer 200 with a status and no room rather than an error.
  func resolveGuestInviteLink(client: Client, token: String) async throws -> Components.Schemas.ResolveChatRoomGuestInviteLink {
    let response = try await client.getChatRoomInviteLinksToken(.init(path: .init(token: token)))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `POST /chat-room-invite-links/{token}/accept`: joins as a guest or reports an existing guest membership.
  func acceptGuestInviteLink(client: Client, token: String, organizationSlug: String?) async throws -> Components.Schemas.AcceptChatRoomGuestInviteLink {
    let response = try await client.postChatRoomInviteLinksTokenAccept(.init(path: .init(token: token), headers: .init(xOrganizationSlug: organizationSlug)))
    switch response {
    case let .ok(value): return try value.body.json.data
    case let .badRequest(value): throw try rejected(status: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try rejected(status: 500, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
