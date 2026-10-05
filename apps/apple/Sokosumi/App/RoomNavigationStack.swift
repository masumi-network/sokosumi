import CoreAPI
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

/// The detail pane for a selected room: its transcript, with an open Thread pushed over it. The room stays
/// mounted under the Thread, so a jump can put it on the Thread's parent while the Thread covers it (row 25c).
/// The room's title bar header comes from its toolbar owner, `RoomToolsModifier` (row 31c).
struct RoomNavigationStack: View {
  @EnvironmentObject private var auth: AuthState
  @EnvironmentObject private var workspaces: WorkspaceState
  let room: Components.Schemas.ChatRoom

  var body: some View {
    NavigationStack {
      RoomTimelineView(roomId: room.id)
        .navigationDestination(isPresented: Binding(
          get: { workspaces.thread.parent != nil },
          set: { presented in
            if !presented {
              Task { @MainActor in workspaces.thread.close() }
            }
          }
        )) {
          ReplyThreadView()
        }
    }
    .task(id: workspaces.streamingThreadToOpen?.id) {
      if let parent = workspaces.streamingThreadToOpen {
        workspaces.openThread(parent, auth: auth)
      }
    }
  }
}
