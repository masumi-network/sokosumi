import CoreAPI
import Foundation
import SokosumiAuth
import SokosumiChat

/// Host-side guest access for external channels (web `guest-invite-section.tsx` inside `edit-channel-dialog.tsx`).
/// Invitations and links are room-scoped sub-resources that never change the room DTO, so they only need the
/// organization-bound request guard; removing a guest edits membership and shares the single-flight channel update.
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

  /// Drops the guest from the room DTO in place (web refreshes the room after removal) without navigating; the
  /// removed guest's own client receives Core's membership-revoked event.
  @discardableResult
  func removeGuest(roomId: String, userId: String, context: UUID, auth: AuthState) async throws -> Bool {
    guard canStartMutation(context: context) else { return false }
    updatingRoom = true
    defer {
      if context == compositionContext {
        updatingRoom = false
      }
    }
    try await channelOperation(context: context, auth: auth) { client, _, slug in
      try await ChatService().removeGuest(client: client, roomId: roomId, userId: userId, organizationSlug: slug)
    }
    if let index = rooms.firstIndex(where: { $0.id == roomId }) {
      var room = rooms[index]
      room.userMembers.removeAll { $0.id == userId }
      rooms[index] = room
    }
    return true
  }
}
