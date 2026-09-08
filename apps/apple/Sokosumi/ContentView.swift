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
      case .signedOut(let message):
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
    case .blocked(let gate):
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
    case .failed(let message):
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
          if workspaces.roomsLoading && workspaces.rooms.isEmpty {
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
                roomRow(room, icon: "person")
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
  @ViewBuilder
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

  private func roomRow(_ room: Components.Schemas.ChatRoom, icon: String) -> some View {
    let attention = resolveRoomAttention(
      unreadCount: room.unreadCount,
      unreadMentionCount: room.unreadMentionCount,
      markedUnread: room.markedUnread,
      isMuted: room.mutedAt != nil,
      isSelected: room.id == selectedRoomId
    )
    let label = Label {
      Text(roomDisplayName(room, currentUserId: workspaces.currentUserId))
        .fontWeight(attention.bold ? .bold : .regular)
    } icon: {
      Image(systemName: icon)
        .foregroundStyle(.secondary)
    }
    .tag(room.id)
    if attention.badgeCount > 0 {
      return AnyView(label.badge(attention.badgeCount))
    }
    return AnyView(label)
  }

  /// "Me" section pinned to the bottom of the sidebar: account menu with
  /// Settings and Sign out.
  @ViewBuilder
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
        avatarView
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

  @ViewBuilder
  private var avatarView: some View {
    if let urlString = workspaces.currentUserImageURL, let url = URL(string: urlString) {
      AsyncImage(url: url) { image in
        image
          .resizable()
          .scaledToFill()
      } placeholder: {
        initialsFallback
      }
      .frame(width: 28, height: 28)
      .clipShape(Circle())
    } else {
      initialsFallback
    }
  }

  private var initialsFallback: some View {
    Text(initials)
      .font(.caption)
      .fontWeight(.semibold)
      .foregroundStyle(.white)
      .frame(width: 28, height: 28)
      .background(Circle().fill(Color.accentColor))
  }

  private var initials: String {
    let words = workspaces.currentUserName.split(separator: " ")
    let first = words.first?.first.map(String.init) ?? ""
    let second = words.dropFirst().first?.first.map(String.init) ?? ""
    let result = first + second
    return result.isEmpty ? "?" : result
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

#Preview {
  ContentView()
    .environmentObject(AuthState(store: PreviewTokenStore()))
    .environmentObject(WorkspaceState())
}

private struct PreviewTokenStore: TokenStore {
  func load() -> OAuthTokens? { nil }
  func save(_ tokens: OAuthTokens) throws {}
  func clear() -> Bool { true }
}
