import SokosumiAuth
import SokosumiChat
import SokosumiRealtime
import SokosumiWorkspace
import SwiftUI

@main
struct SokosumiApp: App {
  @StateObject private var auth = AuthState()
  @StateObject private var workspaces: WorkspaceState
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
        Button("Sign out") {
          auth.signOut()
        }
        .keyboardShortcut("q", modifiers: [.command, .shift])
        .disabled(!auth.isSignedIn)
      }
    }
  }
}
