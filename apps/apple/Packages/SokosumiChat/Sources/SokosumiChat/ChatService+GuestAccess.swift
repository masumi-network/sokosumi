import CoreAPI
import Foundation

/// Host-side guest calls. Core owns the host-member, external-channel, rate-limit and
/// guest-only rules; its messages surface as-is. These are host channel operations, so the organization header is
/// always sent.
public extension ChatService {
  /// `GET /chats/rooms/{id}/invitations`: live pending invitations, newest first.
  func roomInvitations(client: Client, roomId: String, organizationSlug: String) async throws -> [Components.Schemas.ChatRoomInvitation] {
    try await call { try await client.getChatsRoomsIdInvitations(.init(path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug))) }.ok.body.json.data
  }

  /// `POST /chats/rooms/{id}/invitations`: Core normalizes the address, refuses host members and duplicates (409) and
  /// rate-limits (429), then emails the invitee.
  func inviteGuest(client: Client, roomId: String, email: String, organizationSlug: String) async throws -> Components.Schemas.ChatRoomInvitation {
    try await call {
      try await client.postChatsRoomsIdInvitations(.init(
        path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug), body: .json(.init(email: email))
      ))
    }.created.body.json.data
  }

  /// `DELETE /chats/rooms/{id}/invitations/{invitationId}`: only pending invitations revoke; others answer 404.
  func revokeInvitation(client: Client, roomId: String, invitationId: String, organizationSlug: String) async throws {
    _ = try await call {
      try await client.deleteChatsRoomsIdInvitationsInvitationId(.init(
        path: .init(id: roomId, invitationId: invitationId), headers: .init(xOrganizationSlug: organizationSlug)
      ))
    }.noContent
  }

  /// `GET /chats/rooms/{id}/invite-links`: every link including revoked, expired and depleted ones, newest first.
  func guestInviteLinks(client: Client, roomId: String, organizationSlug: String) async throws -> [Components.Schemas.ChatRoomGuestInviteLink] {
    try await call { try await client.getChatsRoomsIdInviteLinks(.init(path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug))) }.ok.body.json.data
  }

  /// `POST /chats/rooms/{id}/invite-links`: `maxUses` nil means unlimited; the expiry travels through
  /// `GuestInviteLinkExpiryMiddleware` because the generated body cannot carry `expiresInDays`.
  func createGuestInviteLink(client: Client, roomId: String, options: GuestInviteLinkOptions, organizationSlug: String) async throws -> Components.Schemas.ChatRoomGuestInviteLink {
    let expiry: GuestInviteLinkExpiryMiddleware.Expiry = options.expiresInDays.map { .days($0) } ?? .never
    return try await call {
      try await GuestInviteLinkExpiryMiddleware.$expiry.withValue(expiry) {
        try await client.postChatsRoomsIdInviteLinks(.init(
          path: .init(id: roomId), headers: .init(xOrganizationSlug: organizationSlug), body: .json(.init(maxUses: options.maxUses))
        ))
      }
    }.created.body.json.data
  }

  /// `DELETE /chats/rooms/{id}/invite-links/{token}`.
  func revokeGuestInviteLink(client: Client, roomId: String, token: String, organizationSlug: String) async throws {
    _ = try await call {
      try await client.deleteChatsRoomsIdInviteLinksToken(.init(
        path: .init(id: roomId, token: token), headers: .init(xOrganizationSlug: organizationSlug)
      ))
    }.ok
  }
}
