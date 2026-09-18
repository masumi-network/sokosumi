import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

/// Minimal Settings: account identity, chat display preferences, the Core
/// endpoint in use and sign out.
struct SettingsView: View {
  @EnvironmentObject private var auth: AuthState
  @EnvironmentObject private var workspaces: WorkspaceState
  @AppStorage(TimeFormatPreference.defaultsKey) private var timeFormat: TimeFormatPreference = .auto
  @State private var saveError: String?

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
      ChatSettingsSection(
        showsRoomUnreadCount: showsRoomUnreadCount,
        isSaving: workspaces.chatDisplay.isSaving,
        isAvailable: auth.isSignedIn,
        saveError: saveError,
        timeFormat: $timeFormat
      )
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
    .task(id: auth.isSignedIn) {
      saveError = nil
      guard auth.isSignedIn else { return }
      await workspaces.refreshChatDisplayPreferences(auth: auth)
    }
  }

  /// The switch flips at once; `ChatDisplayPreferences` puts the previous
  /// value back when Core rejects the write (web `handleToggle`).
  private var showsRoomUnreadCount: Binding<Bool> {
    Binding {
      workspaces.chatDisplay.showsRoomUnreadCount
    } set: { enabled in
      Task { @MainActor in
        saveError = nil
        do {
          try await workspaces.setShowsRoomUnreadCount(enabled, auth: auth)
        } catch {
          saveError = "Could not save that change. Check your connection and try again."
        }
      }
    }
  }
}

/// Web Account → Notifications → "Chat display" and Preferences → "Time
/// format", as one native Settings section. Values come in, so it renders
/// without Core.
struct ChatSettingsSection: View {
  @Binding var showsRoomUnreadCount: Bool
  let isSaving: Bool
  let isAvailable: Bool
  let saveError: String?
  @Binding var timeFormat: TimeFormatPreference

  var body: some View {
    Section("Chat") {
      Toggle(isOn: $showsRoomUnreadCount) {
        Text("Show unread message counts")
        Text("Muted chats and the chat you have open stay quiet. Your notifications do not change.")
        if let saveError {
          Text(saveError).foregroundStyle(.red)
        }
      }
      .disabled(isSaving || !isAvailable)
      Picker(selection: $timeFormat) {
        ForEach(TimeFormatPreference.allCases) { preference in
          Text(preference.title()).tag(preference)
        }
      } label: {
        Text("Time format")
        Text("Choose how times are shown. Auto follows your system settings. Saved on this device.")
      }
    }
  }
}
