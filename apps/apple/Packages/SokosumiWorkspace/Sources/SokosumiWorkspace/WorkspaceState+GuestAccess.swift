import CoreAPI
import Foundation
import SokosumiChat

/// Host-side guest access for external channels (web `guest-invite-section.tsx`, the members panel's Invite from
/// outside tab). Invitations and links are room-scoped sub-resources that never change the room DTO, so they only need
/// the organization-bound request guard. Removing a Guest is a membership change (`WorkspaceState+ChannelMembers`).
public extension WorkspaceState {
  func loadGuestAccess(roomId: String, context: UUID) async throws -> GuestAccessSnapshot {
    try await channelOperation(context: context) { client, _, slug in
      let invitations = try await service.roomInvitations(client: client, roomId: roomId, organizationSlug: slug)
      let links = try await service.guestInviteLinks(client: client, roomId: roomId, organizationSlug: slug)
      return GuestAccessSnapshot(invitations: invitations, links: links)
    }
  }

  func inviteGuest(roomId: String, email: String, context: UUID) async throws -> Components.Schemas.ChatRoomInvitation {
    try await channelOperation(context: context) { client, _, slug in
      try await service.inviteGuest(client: client, roomId: roomId, email: email, organizationSlug: slug)
    }
  }

  func revokeGuestInvitation(roomId: String, invitationId: String, context: UUID) async throws {
    try await channelOperation(context: context) { client, _, slug in
      try await service.revokeInvitation(client: client, roomId: roomId, invitationId: invitationId, organizationSlug: slug)
    }
  }

  func createGuestInviteLink(roomId: String, options: GuestInviteLinkOptions, context: UUID) async throws -> Components.Schemas.ChatRoomGuestInviteLink {
    try await channelOperation(context: context) { client, _, slug in
      try await service.createGuestInviteLink(client: client, roomId: roomId, options: options, organizationSlug: slug)
    }
  }

  func revokeGuestInviteLink(roomId: String, token: String, context: UUID) async throws {
    try await channelOperation(context: context) { client, _, slug in
      try await service.revokeGuestInviteLink(client: client, roomId: roomId, token: token, organizationSlug: slug)
    }
  }
}
