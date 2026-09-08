import SwiftUI

@main
struct SokosumiApp: App {
  @StateObject private var auth = AuthState()
  @StateObject private var workspaces = WorkspaceState()

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
