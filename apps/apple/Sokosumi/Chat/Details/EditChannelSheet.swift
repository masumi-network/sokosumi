import CoreAPI
import SokosumiAuth
import SokosumiWorkspace
import SwiftUI

/// Which channel to edit, bound to the composition context so a workspace switch closes the sheet.
struct EditChannelPresentation: Identifiable, Equatable {
  let id: UUID
  let roomId: String
}

/// One sheet wiring shared by the sidebar row menu and the Members inspector.
struct EditChannelSheet: ViewModifier {
  @Binding var presentation: EditChannelPresentation?
  @EnvironmentObject private var workspaces: WorkspaceState
  @EnvironmentObject private var auth: AuthState
  @State private var lifecycle: ChannelLifecycleRequest?

  func body(content: Content) -> some View {
    content
      .sheet(item: $presentation) { presentation in
        if let room = workspaces.rooms.first(where: { $0.id == presentation.roomId }) {
          EditChannelView(room: room, currentUserId: workspaces.currentUserId, load: {
            try await workspaces.loadChannelRoster(context: presentation.id, auth: auth)
          }, save: {
            try await workspaces.updateChannel($0, roomId: room.id, permissions: $1, context: presentation.id, auth: auth)
          }, requestLifecycle: {
            lifecycle = .init(context: presentation.id, roomId: room.id, name: room.name, action: $0)
          }, guestAccess: guestAccess(roomId: room.id, context: presentation.id))
            .disabled(workspaces.channelLifecycle != nil)
            // Web closes the settings dialog once the channel is gone for this user.
            .modifier(ChannelLifecycleConfirmation(request: $lifecycle) { self.presentation = nil })
        } else {
          // Kicked or archived while the sheet was open: never a blank modal.
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
    }, removeGuest: {
      try await workspaces.removeGuest(roomId: roomId, userId: $0, context: context, auth: auth)
    })
  }
}
