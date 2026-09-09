import CoreAPI
import SokosumiAuth
import SokosumiChat
import SwiftUI

struct ContentView: View {
  @EnvironmentObject private var auth: AuthState
  @EnvironmentObject private var workspaces: WorkspaceState
  @Environment(\.openSettings) private var openSettings

  var body: some View {
    Group {
      switch auth.status {
      case .signedIn:
        chatView
      default:
        authCard
      }
    }
    .onChange(of: auth.isSignedIn) { _, signedIn in
      // Hop off this view update: startIfNeeded/reset publish WorkspaceState.
      Task { @MainActor in
        if signedIn {
          workspaces.startIfNeeded(auth: auth)
        } else {
          workspaces.reset()
        }
      }
    }
  }

  /// Sign-in states render as a small centered card; the signed-in split
  /// view owns the whole window (no inset panel).
  private var authCard: some View {
    VStack(alignment: .leading, spacing: 12) {
      switch auth.status {
      case .notConfigured:
        Text("Sokosumi")
          .font(.title)
        Text("Sign-in is not configured.")
          .font(.headline)
        Text("Set the SOKOSUMI_OAUTH_CLIENT_ID environment variable (or the SokosumiOAuthClientID Info.plist key) to the public OAuth client from SOK-970, then relaunch.")
          .font(.callout)
          .foregroundStyle(.secondary)
      case let .signedOut(message):
        Text("Sokosumi")
          .font(.title)
        if let message {
          Text(message)
            .foregroundStyle(.secondary)
        }
        Button("Sign in with Sokosumi") {
          auth.startSignIn()
        }
        .buttonStyle(.borderedProminent)
      case .signingIn:
        ProgressView("Contacting Sokosumi…")
        Button("Cancel") {
          auth.cancelSignIn()
        }
        .keyboardShortcut(.cancelAction)
      case .signedIn:
        EmptyView()
      }
    }
    .padding(24)
    .frame(minWidth: 420, minHeight: 180, alignment: .topLeading)
  }

  @ViewBuilder
  private var chatView: some View {
    switch workspaces.phase {
    case .idle, .loading:
      ProgressView("Loading workspaces…")
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
          Task { @MainActor in
            workspaces.startIfNeeded(auth: auth)
          }
        }
    case let .blocked(gate):
      VStack(spacing: 8) {
        Text("Finish setup on the web")
          .font(.headline)
        Text(blockedMessage(for: gate))
          .font(.callout)
          .foregroundStyle(.secondary)
        HStack {
          Link("Open setup", destination: CoreSettings.setupURL)
          Button("Check again") {
            workspaces.retry(auth: auth)
          }
          Button("Sign out") {
            auth.signOut()
          }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    case let .failed(message):
      VStack(spacing: 8) {
        Text(message)
          .foregroundStyle(.secondary)
        HStack {
          Button("Retry") {
            workspaces.retry(auth: auth)
          }
          Button("Sign out") {
            auth.signOut()
          }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    case .ready:
      let partitioned = workspaces.sidebar.partitioned
      NavigationSplitView {
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
      } detail: {
        if let selectedRoomId = workspaces.selectedRoomId,
           workspaces.rooms.contains(where: { $0.id == selectedRoomId }) {
          TranscriptView(roomId: selectedRoomId)
        } else {
          Text("Pick a room to read it.")
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      }
    }
    if let signOutError = auth.signOutError {
      Text(signOutError)
        .foregroundStyle(.red)
    }
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
      isMuted: room.mutedAt != nil
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
        CircleAvatar(
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

  private func blockedMessage(for gate: Components.Schemas.WorkspaceGateStatus) -> String {
    switch gate {
    case .pendingInvites:
      "You have pending organization invites but no workspace yet. Accept an invite on the web, then check again."
    case .identityOnboarding:
      "Your account has no workspace yet. Finish setup on the web, then check again."
    case .ready:
      "Unexpected state. Try again."
    }
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
          CircleAvatar(
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

private struct CircleAvatar: View {
  let imageURL: String?
  let name: String
  var size: CGFloat = DirectRoomAvatarStack.faceSize

  @Environment(\.displayScale) private var displayScale
  @State private var cgImage: CGImage?

  var body: some View {
    fill
      .frame(width: size, height: size)
      .compositingGroup()
      .clipShape(Circle())
      .task(id: "\(imageURL ?? "")-\(size)-\(displayScale)") {
        let loaded = await loadAvatarCGImage(
          urlString: imageURL,
          pointSize: size,
          scale: displayScale
        )
        guard !Task.isCancelled else { return }
        cgImage = loaded
      }
  }

  @ViewBuilder
  private var fill: some View {
    if let cgImage {
      Image(decorative: cgImage, scale: displayScale)
        .resizable()
        .interpolation(.high)
        .scaledToFill()
    } else {
      initialsView
    }
  }

  private var initialsView: some View {
    Text(avatarInitials(from: name))
      .font(size >= 24 ? .caption : .caption2)
      .fontWeight(.semibold)
      .foregroundStyle(.white)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Circle().fill(Color.accentColor))
  }
}

#Preview {
  ContentView()
    .environmentObject(AuthState(store: PreviewTokenStore()))
    .environmentObject(WorkspaceState())
}

private struct PreviewTokenStore: TokenStore {
  func load() -> OAuthTokens? {
    nil
  }

  func save(_: OAuthTokens) throws {}
  func clear() -> Bool {
    true
  }
}
