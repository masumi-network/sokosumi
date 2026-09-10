import CoreAPI
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

struct ConversationSidebarView: View {
  @EnvironmentObject private var auth: AuthState
  @EnvironmentObject private var workspaces: WorkspaceState
  @Environment(\.openSettings) private var openSettings

  var body: some View {
    let partitioned = workspaces.sidebar.partitioned
    VStack(spacing: 0) {
      List(selection: Binding(
        get: { workspaces.selectedRoomId },
        set: { newValue in
          // List writes selection during its own update. Publishing
          // selectedRoomId / openRoom there trips SwiftUI's
          // "Publishing changes from within view updates" runtime issue.
          // Nil is structural (collapsed section / missing tag), not a
          // user deselect — skip it so the open transcript stays.
          guard let newValue else { return }
          Task { @MainActor in
            workspaces.selectRoom(newValue, auth: auth)
          }
        }
      )) {
        workspaceMenu
        if workspaces.roomsLoading, workspaces.rooms.isEmpty {
          ProgressView("Loading rooms…")
        } else if workspaces.rooms.isEmpty {
          Text("No rooms yet.")
            .foregroundStyle(.secondary)
        } else {
          // Channels section only for organization workspaces, mirroring web.
          if workspaces.selection?.workspace.organizationId != nil {
            Section("Channels", isExpanded: sectionExpansion(.channels)) {
              if partitioned.channels.isEmpty {
                Text("No channels yet.")
                  .foregroundStyle(.secondary)
              }
              ForEach(partitioned.channels, id: \.id) { room in
                roomRow(room, icon: room.discoverability == ._private ? "lock" : "number")
              }
            }
          }
          if !partitioned.external.isEmpty {
            Section("External", isExpanded: sectionExpansion(.external)) {
              ForEach(partitioned.external, id: \.id) { room in
                roomRow(room, icon: "globe")
              }
            }
          }
          Section("Directs", isExpanded: sectionExpansion(.directs)) {
            if partitioned.directMessages.isEmpty {
              Text("No direct messages yet.")
                .foregroundStyle(.secondary)
            }
            ForEach(partitioned.directMessages, id: \.id) { room in
              roomRow(room, icon: "person", showsDirectAvatars: true)
            }
          }
        }
      }
      .listStyle(.sidebar)
      .toolbar {
        ToolbarItem {
          Button("Refresh conversations", systemImage: "arrow.clockwise") {
            Task { await workspaces.refreshRooms(auth: auth) }
          }
          .disabled(workspaces.roomsLoading)
        }
      }
      if workspaces.roomsLoading {
        ProgressView("Refreshing conversations…")
          .controlSize(.small)
          .padding(8)
      }
      if let error = workspaces.sidebar.errorMessage {
        VStack(alignment: .leading, spacing: 4) {
          Text(error).font(.caption).foregroundStyle(.secondary)
          Button("Retry") { Task { await workspaces.refreshRooms(auth: auth) } }
        }
        .padding(8)
      }
      if let switchError = workspaces.switchError {
        Text(switchError)
          .font(.caption)
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 8)
          .padding(.vertical, 4)
      }
      Divider()
      meSection
    }
    .navigationSplitViewColumnWidth(min: 220, ideal: 260)
  }

  private func sectionExpansion(_ section: ConversationSidebar.Section) -> Binding<Bool> {
    Binding(
      get: { !workspaces.sidebar.collapsedSections.contains(section) },
      set: { expanded in
        Task { @MainActor in workspaces.sidebar.setExpanded(expanded, section: section) }
      }
    )
  }

  /// Workspace switcher pinned to the top of the sidebar.
  private var workspaceMenu: some View {
    Menu {
      ForEach(workspaces.options) { option in
        Button {
          workspaces.select(option, auth: auth)
        } label: {
          HStack {
            Text(option.title)
            if option.id == workspaces.selectionId {
              Image(systemName: "checkmark")
            }
          }
        }
      }
    } label: {
      HStack {
        Text(workspaces.selection?.title ?? "Sokosumi")
          .font(.headline)
        Image(systemName: "chevron.down")
          .font(.caption)
          .foregroundStyle(.secondary)
        Spacer()
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .padding(.vertical, 4)
  }

  private func roomRow(
    _ room: Components.Schemas.ChatRoom,
    icon: String,
    showsDirectAvatars: Bool = false
  ) -> some View {
    let attention = resolveRoomAttention(
      unreadCount: room.unreadCount,
      unreadMentionCount: room.unreadMentionCount,
      markedUnread: room.markedUnread,
      isMuted: room.mutedAt != nil,
      isActive: room.id == workspaces.selectedRoomId
    )
    return Label {
      VStack(alignment: .leading, spacing: 2) {
        Text(roomDisplayName(room, currentUserId: workspaces.currentUserId))
          .lineLimit(1)
          .fontWeight(attention.bold ? .bold : .regular)
        if room.myAccess == .guest, let organization = room.organizationName, !organization.isEmpty {
          Text(organization)
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
    } icon: {
      RoomLeadingIcon(
        room: room,
        icon: icon,
        currentUserId: workspaces.currentUserId,
        showsDirectAvatars: showsDirectAvatars
      )
    }
    .labelStyle(RoomRowLabelStyle())
    .tag(room.id)
    .badge(attention.badgeCount)
    .contextMenu {
      Button("Mark unread", systemImage: "envelope.badge") {
        Task { @MainActor in await workspaces.markRoomUnread(room, auth: auth) }
      }
      .disabled(room.id == workspaces.selectedRoomId || room.mutedAt != nil)
    }
  }

  /// "Me" section pinned to the bottom of the sidebar: account menu with
  /// Settings and Sign out.
  private var meSection: some View {
    Menu {
      Button("Settings…") {
        openSettings()
      }
      Divider()
      Button("Sign out") {
        auth.signOut()
      }
    } label: {
      HStack(spacing: 8) {
        ParticipantAvatar(
          imageURL: workspaces.currentUserImageURL,
          name: workspaces.currentUserName,
          size: 28
        )
        VStack(alignment: .leading, spacing: 0) {
          Text(workspaces.currentUserName.isEmpty ? "Me" : workspaces.currentUserName)
            .font(.callout)
            .lineLimit(1)
          if !workspaces.currentUserEmail.isEmpty {
            Text(workspaces.currentUserEmail)
              .font(.caption)
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }
        }
        Spacer()
      }
      .padding(8)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }
}

/// Sidebar `Label` otherwise pins the icon to a square column, which
/// squashes a group Direct stack into overlapping blobs.
private struct RoomRowLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 8) {
      configuration.icon
        .fixedSize()
      configuration.title
        .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

/// Sidebar leading slot. Direct messages get the participant stack; channels
/// and External keep an SF Symbol. Guest Directs in External stay a symbol.
private struct RoomLeadingIcon: View {
  let icon: String
  let showsDirectAvatars: Bool
  let participants: [DirectRoomAvatarParticipant]

  init(
    room: Components.Schemas.ChatRoom,
    icon: String,
    currentUserId: String,
    showsDirectAvatars: Bool
  ) {
    self.icon = icon
    self.showsDirectAvatars = showsDirectAvatars
    participants = showsDirectAvatars
      ? directRoomAvatarParticipants(room, currentUserId: currentUserId)
      : []
  }

  var body: some View {
    if showsDirectAvatars {
      DirectRoomAvatarStack(participants: participants)
    } else {
      Image(systemName: icon)
        .foregroundStyle(.secondary)
        .frame(width: DirectRoomAvatarStack.faceSize, height: DirectRoomAvatarStack.faceSize)
    }
  }
}

private struct DirectRoomAvatarStack: View {
  /// Web `DirectRoomAvatarStack`: `size-5` faces, `-ml-2` overlap.
  static let faceSize: CGFloat = 20
  private static let overlap: CGFloat = 8

  let participants: [DirectRoomAvatarParticipant]

  var body: some View {
    stackContent
      .accessibilityHidden(true)
  }

  @ViewBuilder
  private var stackContent: some View {
    if participants.isEmpty {
      Image(systemName: "message")
        .foregroundStyle(.secondary)
        .frame(width: Self.faceSize, height: Self.faceSize)
    } else {
      HStack(spacing: -Self.overlap) {
        ForEach(participants.enumerated(), id: \.element.id) { index, participant in
          ParticipantAvatar(
            imageURL: participant.imageURL,
            name: participant.name,
            size: Self.faceSize
          )
          .overlay {
            Circle()
              .strokeBorder(.background, lineWidth: 1)
          }
          .zIndex(Double(participants.count - index))
        }
      }
    }
  }
}
