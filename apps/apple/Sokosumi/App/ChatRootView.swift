import CoreAPI
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

struct ChatRootView: View {
  @EnvironmentObject private var auth: AuthState
  @EnvironmentObject private var workspaces: WorkspaceState
  @State private var windowID = UUID()
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    Group {
      switch auth.status {
      case .signedIn:
        chatView
      default:
        SignInView()
      }
    }
    .task(id: scenePhase) {
      workspaces.setWindowVisible(scenePhase == .active, window: windowID)
      await workspaces.syncReadAttention(auth: auth)
    }
    .onDisappear {
      Task { @MainActor in workspaces.setWindowVisible(false, window: windowID) }
    }
    .onChange(of: workspaces.readContent) { _, _ in
      Task { @MainActor in await workspaces.syncReadAttention(auth: auth) }
    }
    .onChange(of: workspaces.thread.timeline.isLoading) { _, _ in
      Task { @MainActor in await workspaces.syncReadAttention(auth: auth) }
    }
    .onChange(of: workspaces.timeline.hasLoadedHistory) { _, _ in
      Task { @MainActor in await workspaces.syncReadAttention(auth: auth) }
    }
    .alert("Couldn’t update unread status", isPresented: Binding(
      get: { workspaces.readAttention.errorMessage != nil },
      set: {
        if !$0 {
          workspaces.readAttention.clearError()
        }
      }
    )) {
      Button("OK") { workspaces.readAttention.clearError() }
    } message: {
      Text(workspaces.readAttention.errorMessage ?? "")
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
      NavigationSplitView {
        ConversationSidebarView()
      } detail: {
        if let selectedRoomId = workspaces.selectedRoomId,
           let selectedRoom = workspaces.rooms.first(where: { $0.id == selectedRoomId }) {
          NavigationStack {
            RoomTimelineView(roomId: selectedRoomId)
              .navigationTitle(roomDisplayName(selectedRoom, currentUserId: workspaces.currentUserId))
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
            await Task { @MainActor in
              if let parent = workspaces.streamingThreadToOpen {
                workspaces.openThread(parent, auth: auth)
              }
            }.value
          }
        } else {
          Text("Pick a room to read it.")
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle(workspaces.selection?.title ?? "")
        }
      }
    }
    if let signOutError = auth.signOutError {
      Text(signOutError)
        .foregroundStyle(.red)
    }
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
  ChatRootView()
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
