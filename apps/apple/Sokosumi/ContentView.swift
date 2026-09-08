import CoreAPI
import SokosumiAuth
import SokosumiChat
import SwiftUI

struct ContentView: View {
  @EnvironmentObject private var auth: AuthState
  @EnvironmentObject private var workspaces: WorkspaceState
  @Environment(\.openSettings) private var openSettings
  @State private var selectedRoomId: String?

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
      if signedIn {
        workspaces.startIfNeeded(auth: auth)
      } else {
        workspaces.reset()
        selectedRoomId = nil
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
        .onAppear { workspaces.startIfNeeded(auth: auth) }
    case let .blocked(gate):
      VStack(spacing: 8) {
        Text("Finish setup on the web")
          .font(.headline)
        Text(blockedMessage(for: gate))
          .font(.callout)
          .foregroundStyle(.secondary)
        HStack {
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
      let partitioned = partitionRoomsForSidebar(workspaces.rooms)
      NavigationSplitView {
        VStack(spacing: 0) {
          List(selection: $selectedRoomId) {
            workspaceMenu
            if workspaces.roomsLoading, workspaces.rooms.isEmpty {
              ProgressView("Loading rooms…")
            } else if workspaces.rooms.isEmpty {
              Text("No rooms yet.")
                .foregroundStyle(.secondary)
            } else {
              // Channels section only for organization workspaces, mirroring web.
              if workspaces.selection?.workspace.organizationId != nil {
                Section("Channels") {
                  if partitioned.channels.isEmpty {
                    Text("No channels yet.")
                      .foregroundStyle(.secondary)
                  }
                  ForEach(partitioned.channels, id: \.id) { room in
                    roomRow(room, icon: "number")
                  }
                }
              }
              Section("Direct messages") {
                if partitioned.directMessages.isEmpty {
                  Text("No direct messages yet.")
                    .foregroundStyle(.secondary)
                }
                ForEach(partitioned.directMessages, id: \.id) { room in
                  roomRow(room, icon: "person", showsDirectAvatars: true)
                }
              }
              if !partitioned.external.isEmpty {
                Section("External") {
                  ForEach(partitioned.external, id: \.id) { room in
                    roomRow(room, icon: "building.2")
                  }
                }
              }
            }
          }
          .listStyle(.sidebar)
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
        if let selected = workspaces.rooms.first(where: { $0.id == selectedRoomId }) {
          VStack {
            Text(roomDisplayName(selected, currentUserId: workspaces.currentUserId))
              .font(.headline)
            Text("Transcript lands in the next ticket.")
              .font(.caption)
              .foregroundStyle(.tertiary)
          }
        } else {
          VStack {
            Text("Pick a room to read it.")
              .foregroundStyle(.secondary)
            Text("Transcript lands in the next ticket.")
              .font(.caption)
              .foregroundStyle(.tertiary)
          }
        }
      }
    }
    if let signOutError = auth.signOutError {
      Text(signOutError)
        .foregroundStyle(.red)
    }
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
      Text(roomDisplayName(room, currentUserId: workspaces.currentUserId))
        .fontWeight(attention.bold ? .bold : .regular)
    } icon: {
      RoomLeadingIcon(
        room: room,
        icon: icon,
        currentUserId: workspaces.currentUserId,
        showsDirectAvatars: showsDirectAvatars
      )
    }
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
    }
  }
}

private struct DirectRoomAvatarStack: View {
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
    } else {
      HStack(spacing: -6) {
        ForEach(participants.enumerated(), id: \.element.id) { index, participant in
          CircleAvatar(
            imageURL: participant.imageURL,
            name: participant.name,
            size: 16
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
  var size: CGFloat = 16

  var body: some View {
    fill
      .frame(width: size, height: size)
      .clipShape(Circle())
  }

  @ViewBuilder
  private var fill: some View {
    if let urlString = imageURL, let url = URL(string: urlString) {
      AsyncImage(url: url) { phase in
        switch phase {
        case let .success(image):
          image
            .resizable()
            .scaledToFill()
        default:
          initialsView
        }
      }
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

private func avatarInitials(from name: String) -> String {
  let words = name.split(separator: " ")
  let first = words.first?.first.map(String.init) ?? ""
  let second = words.dropFirst().first?.first.map(String.init) ?? ""
  let result = (first + second).uppercased()
  return result.isEmpty ? "?" : result
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
