import SwiftUI

@main
struct SokosumiApp: App {
  @StateObject private var auth = AuthState()

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(auth)
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
