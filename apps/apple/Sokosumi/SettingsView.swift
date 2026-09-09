import SokosumiAuth
import SwiftUI

/// Minimal Settings: account identity plus the Core endpoint in use.
struct SettingsView: View {
  @EnvironmentObject private var auth: AuthState
  @EnvironmentObject private var workspaces: WorkspaceState

  var body: some View {
    Form {
      Section("Account") {
        LabeledContent("Name") {
          Text(workspaces.currentUserName.isEmpty ? "—" : workspaces.currentUserName)
            .textSelection(.enabled)
        }
        LabeledContent("Email") {
          Text(workspaces.currentUserEmail.isEmpty ? "—" : workspaces.currentUserEmail)
            .textSelection(.enabled)
        }
      }
      Section("Core") {
        LabeledContent("Base URL") {
          Text(CoreSettings.baseURL.absoluteString)
            .font(.caption)
            .textSelection(.enabled)
        }
      }
      Section {
        Button("Sign out") {
          auth.signOut()
        }
        .disabled(!auth.isSignedIn)
      }
    }
    .formStyle(.grouped)
    .frame(width: 400)
    .padding()
  }
}
