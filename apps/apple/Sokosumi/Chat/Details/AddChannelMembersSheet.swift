import CoreAPI
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

/// Wires the members panel's Add picker to `WorkspaceState`; a workspace switch closes it like the settings sheet.
struct AddChannelMembersSheet: ViewModifier {
  @Binding var presentation: RoomEditPresentation?
  @EnvironmentObject private var workspaces: WorkspaceState
  @EnvironmentObject private var auth: AuthState

  func body(content: Content) -> some View {
    content
      .sheet(item: $presentation) { presentation in
        if let room = workspaces.rooms.first(where: { $0.id == presentation.roomId }) {
          AddChannelMembersView(room: room, currentUserId: workspaces.currentUserId, load: {
            try await workspaces.loadChannelRoster(context: presentation.id, auth: auth).recipients
          }, add: {
            try await workspaces.addChannelMembers($0, roomId: room.id, context: presentation.id, auth: auth)
          }, guestAccess: guestAccess(roomId: room.id, context: presentation.id))
        } else {
          // Removed or archived while the sheet was open: never a blank modal.
          VStack(spacing: 16) {
            ContentUnavailableView("This channel is no longer available.", systemImage: "number")
            Button("Close") { self.presentation = nil }.keyboardShortcut(.cancelAction)
          }
          .padding(20)
          .frame(width: 480)
        }
      }
      .onChange(of: workspaces.compositionContext) { _, _ in
        presentation = nil
      }
  }

  private func guestAccess(roomId: String, context: UUID) -> GuestAccessActions {
    GuestAccessActions(load: {
      try await workspaces.loadGuestAccess(roomId: roomId, context: context, auth: auth)
    }, invite: {
      try await workspaces.inviteGuest(roomId: roomId, email: $0, context: context, auth: auth)
    }, revokeInvitation: {
      try await workspaces.revokeGuestInvitation(roomId: roomId, invitationId: $0, context: context, auth: auth)
    }, createLink: {
      try await workspaces.createGuestInviteLink(roomId: roomId, options: $0, context: context, auth: auth)
    }, revokeLink: {
      try await workspaces.revokeGuestInviteLink(roomId: roomId, token: $0, context: context, auth: auth)
    })
  }
}
