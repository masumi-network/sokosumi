import SokosumiAuth
import SokosumiChat
import SokosumiRealtime
import SokosumiWorkspace
import SwiftUI

@main
struct SokosumiApp: App {
  @StateObject private var auth = AuthState()
  @StateObject private var workspaces: WorkspaceState
  @StateObject private var updater = AppUpdater()
  /// Device-local clock preference; every window's timestamps read it from the environment.
  @AppStorage(TimeFormatPreference.defaultsKey) private var timeFormat: TimeFormatPreference = .auto

  init() {
    let cooldown = ChatReadCooldown()
    // The Unreads filter is remembered per install (row 24f2); tests and previews leave it transient.
    let workspaces = WorkspaceState(clientProvider: { $0.coreClient(cooldown: cooldown) }, unreadsFilter: .standard)
    // Live room updates over Ably (SOK-976). The state drives the socket;
    // without this factory it stays HTTP-only.
    workspaces.realtimeConnectionFactory = { AblyRealtimeConnection() }
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
        if updater.isEnabled {
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
          Task { @MainActor in await workspaces.markAllUnreadRead(auth: auth) }
        }
        .disabled(!workspaces.offersMarkAllUnreadRead(isSignedIn: auth.isSignedIn))
      }
    }
  }
}
