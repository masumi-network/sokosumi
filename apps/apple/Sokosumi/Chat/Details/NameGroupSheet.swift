import CoreAPI
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

/// The String Catalog for group Direct naming (`ChatGroupName.xcstrings`).
let groupNameTable = "ChatGroupName"

/// One sheet wiring shared by the sidebar row menu and the Members inspector.
struct NameGroupSheet: ViewModifier {
  @Binding var presentation: RoomEditPresentation?
  @EnvironmentObject private var workspaces: WorkspaceState
  @EnvironmentObject private var auth: AuthState

  func body(content: Content) -> some View {
    content
      .sheet(item: $presentation) { presentation in
        if let room = workspaces.rooms.first(where: { $0.id == presentation.roomId }), GroupNameDraft.canName(room) {
          NameGroupView(room: room) {
            try await workspaces.nameGroup($0, roomId: room.id, context: presentation.id, auth: auth)
          }
        } else {
          // Left or gone while the sheet was open: never a blank modal.
          VStack(spacing: 16) {
            ContentUnavailableView {
              Label {
                Text("This group is no longer available.", tableName: groupNameTable,
                     comment: "Shown in the Name Group sheet when the group Direct is gone.")
              } icon: {
                Image(systemName: "person.2")
              }
            }
            Button { self.presentation = nil } label: {
              Text("Close", tableName: groupNameTable, comment: "Closes the Name Group sheet.")
            }
            .keyboardShortcut(.cancelAction)
          }
          .padding(20)
          .frame(width: 420)
        }
      }
      .onChange(of: workspaces.compositionContext) { _, _ in
        presentation = nil
      }
  }
}

/// The "Name Group…" command for the sidebar row menu and the Members inspector.
struct NameGroupLabel: View {
  var body: some View {
    Label {
      Text("Name Group…", tableName: groupNameTable, comment: "Opens the sheet that names a group Direct.")
    } icon: {
      Image(systemName: "pencil")
    }
  }
}
