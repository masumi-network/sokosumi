import CoreAPI
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

/// Which channel or group Direct to edit, bound to the composition context so a workspace switch closes the sheet.
struct RoomEditPresentation: Identifiable, Equatable {
  let id: UUID
  let roomId: String
}

/// One sheet wiring shared by the sidebar row menu and the Members inspector. Both open it for organization owners
/// and admins only; everyone else manages membership from the members panel.
struct EditChannelSheet: ViewModifier {
  @Binding var presentation: RoomEditPresentation?
  @EnvironmentObject private var workspaces: WorkspaceState
  @EnvironmentObject private var auth: AuthState
  @State private var lifecycle: ChannelLifecycleRequest?

  func body(content: Content) -> some View {
    content
      .sheet(item: $presentation) { presentation in
        if let room = workspaces.rooms.first(where: { $0.id == presentation.roomId }) {
          EditChannelView(room: room, save: {
            try await workspaces.updateChannel($0, roomId: room.id, context: presentation.id, auth: auth)
          }, requestArchive: {
            lifecycle = .init(context: presentation.id, roomId: room.id, name: room.name, action: .archive)
          })
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
}
