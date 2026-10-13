import CoreAPI
import SokosumiAuth
import SokosumiChat
import SokosumiRealtime
import SokosumiWorkspace
import SwiftUI

@main
struct SokosumiApp: App {
  @StateObject private var auth: AuthState
  @StateObject private var workspaces: WorkspaceState
  @StateObject private var updater = AppUpdater()
  /// Device-local clock preference; every window's timestamps read it from the environment.
  @AppStorage(TimeFormatPreference.defaultsKey) private var timeFormat: TimeFormatPreference = .auto

  init() {
    let auth = AuthState()
    let cooldown = ChatReadCooldown()
    // The Unreads filter is remembered per install (row 24f2); tests and previews leave it transient.
    let workspaces = WorkspaceState(
      auth: auth,
      clientProvider: { auth in
        auth.oauthSession.map { Client.workspace(session: $0, cooldown: cooldown, baseURL: CoreSettings.baseURL, build: CoreSettings.build) }
      },
      unreadsFilter: .standard,
      // Live room updates over Ably (SOK-976); the state drives the socket.
      realtimeConnectionFactory: { AblyRealtimeConnection() },
      notificationPresenter: ChatNotificationCenter.shared
    )
    _auth = StateObject(wrappedValue: auth)
    _workspaces = StateObject(wrappedValue: workspaces)
  }

  var body: some Scene {
    WindowGroup {
      ChatRootView()
        .environmentObject(auth)
        .environmentObject(workspaces)
        .environment(\.timeFormat, timeFormat)
    }
    Settings {
      SettingsView()
        .environmentObject(auth)
        .environmentObject(workspaces)
    }
    .commands {
      CommandGroup(after: .appInfo) {
        if AppUpdater.isPublishBuild {
          Button("Check for Updates…") {
            updater.checkForUpdates()
          }
          .disabled(!updater.canCheckForUpdates)
        }
        Button("Sign out") {
          auth.signOut()
        }
        .keyboardShortcut("q", modifiers: [.command, .shift])
        .disabled(!auth.isSignedIn)
      }
      // Row 24f2 / SOK-1201: the sidebar's Unreads filter had no keyboard path, because the List's selection
      // never reaches the toggle row. These View-menu commands are it: ⌘⇧U toggles the filter (the same
      // shortcut as web), and Mark all as read is offered under the rule that shows the sidebar row's button.
      // A bulk action carries no shortcut of its own.
      CommandGroup(after: .sidebar) {
        Toggle("Unreads", isOn: Binding(
          get: { workspaces.sidebar.unreadsFilterOn },
          set: { workspaces.sidebar.setUnreadsFilter($0) }
        ))
        .keyboardShortcut("u", modifiers: [.command, .shift])
        .disabled(!auth.isSignedIn)

        Button("Mark All as Read") {
          Task { @MainActor in await workspaces.markAllUnreadRead() }
        }
        .disabled(!workspaces.offersMarkAllUnreadRead(isSignedIn: auth.isSignedIn))
      }
    }
  }
}
