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

  func body(content: Content) -> some View {
    content
      .sheet(item: $presentation) { presentation in
        if let room = workspaces.rooms.first(where: { $0.id == presentation.roomId }) {
          EditChannelView(room: room, currentUserId: workspaces.currentUserId, load: {
            try await workspaces.loadChannelRoster(context: presentation.id, auth: auth)
          }, save: {
            try await workspaces.updateChannel($0, roomId: room.id, permissions: $1, context: presentation.id, auth: auth)
          })
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
}
