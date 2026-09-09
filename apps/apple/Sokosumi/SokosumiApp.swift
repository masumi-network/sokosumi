import SokosumiRealtime
import SwiftUI

@main
struct SokosumiApp: App {
  @StateObject private var auth = AuthState()
  @StateObject private var workspaces: WorkspaceState

  init() {
    let workspaces = WorkspaceState()
    // Live room updates over Ably (SOK-976). The state drives the socket;
    // without this factory it stays HTTP-only.
    workspaces.realtimeConnectionFactory = { AblyRealtimeConnection() }
    _workspaces = StateObject(wrappedValue: workspaces)
  }

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(auth)
        .environmentObject(workspaces)
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
