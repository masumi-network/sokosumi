import CoreAPI
import Foundation
import SokosumiAuth
import SokosumiChat

/// Host-side guest access for external channels (web `guest-invite-section.tsx`, the members panel's Invite from
/// outside tab). Invitations and links are room-scoped sub-resources that never change the room DTO, so they only need
/// the organization-bound request guard. Removing a Guest is a membership change (`WorkspaceState+ChannelMembers`).
public extension WorkspaceState {
  func loadGuestAccess(roomId: String, context: UUID, auth: AuthState) async throws -> GuestAccessSnapshot {
    try await channelOperation(context: context, auth: auth) { client, _, slug in
      let invitations = try await ChatService().roomInvitations(client: client, roomId: roomId, organizationSlug: slug)
      let links = try await ChatService().guestInviteLinks(client: client, roomId: roomId, organizationSlug: slug)
      return GuestAccessSnapshot(invitations: invitations, links: links)
    }
  }

  func inviteGuest(roomId: String, email: String, context: UUID, auth: AuthState) async throws -> Components.Schemas.ChatRoomInvitation {
    try await channelOperation(context: context, auth: auth) { client, _, slug in
      try await ChatService().inviteGuest(client: client, roomId: roomId, email: email, organizationSlug: slug)
    }
  }

  func revokeGuestInvitation(roomId: String, invitationId: String, context: UUID, auth: AuthState) async throws {
    try await channelOperation(context: context, auth: auth) { client, _, slug in
      try await ChatService().revokeInvitation(client: client, roomId: roomId, invitationId: invitationId, organizationSlug: slug)
    }
  }

  func createGuestInviteLink(roomId: String, options: GuestInviteLinkOptions, context: UUID, auth: AuthState) async throws -> Components.Schemas.ChatRoomGuestInviteLink {
    try await channelOperation(context: context, auth: auth) { client, _, slug in
      try await ChatService().createGuestInviteLink(client: client, roomId: roomId, options: options, organizationSlug: slug)
    }
  }

  func revokeGuestInviteLink(roomId: String, token: String, context: UUID, auth: AuthState) async throws {
    try await channelOperation(context: context, auth: auth) { client, _, slug in
      try await ChatService().revokeGuestInviteLink(client: client, roomId: roomId, token: token, organizationSlug: slug)
    }
  }
}
