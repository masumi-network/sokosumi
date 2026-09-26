import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

/// An in-app invite or join link, bound to the composition context it was opened in so a workspace switch closes it.
struct InviteLinkPresentation: Identifiable, Equatable {
  enum Destination: Equatable {
    case invitation(id: String)
    case guestJoin(token: String)
  }

  let id = UUID()
  let context: UUID
  let destination: Destination
}

/// Presents web's `/chat/invites/{id}` and `/chat/join/{token}` pages as sheets over the chat window.
struct InviteLinkSheet: ViewModifier {
  @Binding var presentation: InviteLinkPresentation?
  @EnvironmentObject private var workspaces: WorkspaceState
  @EnvironmentObject private var auth: AuthState

  func body(content: Content) -> some View {
    content
      .sheet(item: $presentation) { presentation in
        switch presentation.destination {
        case let .invitation(id):
          ChatInviteView(invitationId: id, load: {
            try await workspaces.loadInvitation(id: $0, context: presentation.context, auth: auth)
          }, respond: { action, id in
            switch action {
            case .accept: try await workspaces.acceptInvitation(id: id, context: presentation.context, auth: auth)
            case .decline: try await workspaces.declineInvitation(id: id, context: presentation.context, auth: auth)
            }
          }, openRoom: { roomId in
            Task { @MainActor in await workspaces.openInvitedRoom(roomId, context: presentation.context, auth: auth) }
          })
        case let .guestJoin(token):
          ChatJoinView(token: token, resolve: {
            try await workspaces.resolveGuestInviteLink(token: $0, context: presentation.context, auth: auth)
          }, join: {
            try await workspaces.acceptGuestInviteLink(token: $0, context: presentation.context, auth: auth)
          })
        }
      }
      .onChange(of: workspaces.compositionContext) { _, _ in
        presentation = nil
      }
  }
}
