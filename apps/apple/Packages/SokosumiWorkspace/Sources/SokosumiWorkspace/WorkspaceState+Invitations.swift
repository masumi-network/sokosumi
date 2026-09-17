import CoreAPI
import Foundation
import SokosumiAuth
import SokosumiChat

/// External chat invitations (web `organization-chat-list.client.tsx`, `chat-room-invitation-card.tsx`,
/// `chat-join-actions.tsx`). Core owns invitee matching, expiry, link usage and host rules; accept and join re-read the
/// room list because their responses carry no room DTO, then open the room unless the user navigated meanwhile.
public extension WorkspaceState {
  /// Web refreshes the invitations collection on mount and recovery in every workspace; loads fail soft.
  func loadPendingInvitations(auth: AuthState) async {
    let context = compositionContext
    let slug = selection?.workspace.organizationSlug
    await pendingInvitations.load {
      try await workspaceOperation(context: context, auth: auth) { client in
        try await ChatService().pendingInvitations(client: client, organizationSlug: slug)
      }
    }
  }

  func loadInvitation(id: String, context: UUID, auth: AuthState) async throws -> Components.Schemas.ChatRoomInvitation {
    let slug = selection?.workspace.organizationSlug
    return try await workspaceOperation(context: context, auth: auth) { client in
      try await ChatService().invitation(client: client, id: id, organizationSlug: slug)
    }
  }

  /// Accepting joins the channel as a guest: drop the pending row, re-list rooms and open the joined room.
  @discardableResult
  func acceptInvitation(id: String, context: UUID, auth: AuthState) async throws -> Bool {
    let sourceRoom = transcriptRoomId
    let slug = selection?.workspace.organizationSlug
    return try await runInvitationResponse(.accept, id: id, context: context) {
      let invitation = try await workspaceOperation(context: context, auth: auth) { client in
        try await ChatService().acceptInvitation(client: client, id: id, organizationSlug: slug)
      }
      pendingInvitations.remove(id: id)
      await openJoinedRoom(invitation.roomId, sourceRoom: sourceRoom, context: context, auth: auth)
    }
  }

  @discardableResult
  func declineInvitation(id: String, context: UUID, auth: AuthState) async throws -> Bool {
    let slug = selection?.workspace.organizationSlug
    return try await runInvitationResponse(.decline, id: id, context: context) {
      _ = try await workspaceOperation(context: context, auth: auth) { client in
        try await ChatService().declineInvitation(client: client, id: id, organizationSlug: slug)
      }
      pendingInvitations.remove(id: id)
    }
  }

  func resolveGuestInviteLink(token: String, context: UUID, auth: AuthState) async throws -> Components.Schemas.ResolveChatRoomGuestInviteLink {
    try await workspaceOperation(context: context, auth: auth) { client in
      try await ChatService().resolveGuestInviteLink(client: client, token: token)
    }
  }

  /// Joining through a link is one more guest membership: same single-flight and navigation as an accepted invitation.
  @discardableResult
  func acceptGuestInviteLink(token: String, context: UUID, auth: AuthState) async throws -> Bool {
    let sourceRoom = transcriptRoomId
    let slug = selection?.workspace.organizationSlug
    return try await runInvitationResponse(.accept, id: token, context: context) {
      let joined = try await workspaceOperation(context: context, auth: auth) { client in
        try await ChatService().acceptGuestInviteLink(client: client, token: token, organizationSlug: slug)
      }
      await openJoinedRoom(joined.roomId, sourceRoom: sourceRoom, context: context, auth: auth)
    }
  }

  /// The accepted card's "Open channel": an invitation accepted on another device is not in the local list until the
  /// next refresh, so re-list first. The click is explicit, so no navigation guard applies.
  func openInvitedRoom(_ roomId: String, context: UUID, auth: AuthState) async {
    guard context == compositionContext else { return }
    if !rooms.contains(where: { $0.id == roomId }) {
      await roomsRefreshTask?.value
      await refreshRooms(auth: auth)
    }
    guard context == compositionContext, rooms.contains(where: { $0.id == roomId }) else { return }
    selectRoom(roomId, auth: auth)
  }

  /// Guest rooms are listed in every workspace, so the current list gains the room; a completed request must not pull the user away from a room they selected meanwhile.
  private func openJoinedRoom(_ roomId: String, sourceRoom: String?, context: UUID, auth: AuthState) async {
    // A list refresh that started before the membership was granted cannot contain the room.
    await roomsRefreshTask?.value
    await refreshRooms(auth: auth)
    guard context == compositionContext, rooms.contains(where: { $0.id == roomId }), transcriptRoomId == sourceRoom else { return }
    selectRoom(roomId, auth: auth)
  }

  private func runInvitationResponse(_ action: InvitationAction, id: String, context: UUID, perform: () async throws -> Void) async throws -> Bool {
    guard canStartMutation(context: context) else { return false }
    invitationResponse = .init(invitationId: id, action: action)
    defer {
      if context == compositionContext {
        invitationResponse = nil
      }
    }
    try await perform()
    return true
  }
}
