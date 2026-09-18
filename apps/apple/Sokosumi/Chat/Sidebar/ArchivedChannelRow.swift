import CoreAPI
import SokosumiChat
import SwiftUI

/// Web Archived rows (`organization-chat-list.client.tsx`): dimmed visibility icon and name, Restore for every listed
/// channel, Delete for organization owners/admins. Rows are not selectable; archived transcripts are unreadable.
struct ArchivedChannelRow: View {
  let room: Components.Schemas.ChatRoom
  let pending: Bool
  let busy: Bool
  let canDelete: Bool
  let request: (ChannelLifecycleAction) -> Void

  var body: some View {
    Label {
      HStack(spacing: 6) {
        Text(room.name)
          .lineLimit(1)
          .foregroundStyle(.secondary)
        Spacer(minLength: 0)
        Group {
          if pending {
            ProgressView()
              .controlSize(.mini)
              .accessibilityLabel("Updating \(room.name)")
          } else {
            Button("Restore \(room.name)", systemImage: "arrow.counterclockwise") { request(.restore) }
              .labelStyle(.iconOnly)
              .buttonStyle(.borderless)
              .foregroundStyle(.secondary)
              .disabled(busy)
              .help("Restore")
          }
        }
        .frame(width: 20)
      }
    } icon: {
      Image(systemName: room.discoverability == ._private ? "lock" : room.discoverability == .external ? "globe" : "number")
        .foregroundStyle(.tertiary)
        .frame(width: DirectRoomAvatarStack.faceSize, height: DirectRoomAvatarStack.faceSize)
    }
    .labelStyle(RoomRowLabelStyle())
    .listRowInsets(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
    .selectionDisabled()
    .contextMenu {
      Button("Restore", systemImage: "arrow.counterclockwise") { request(.restore) }
        .disabled(busy)
      if canDelete {
        Button("Delete…", systemImage: "trash", role: .destructive) { request(.delete) }
          .disabled(busy)
      }
    }
  }
}
