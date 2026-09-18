import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

/// Minimal Settings: account identity, chat display preferences, the Core
/// endpoint in use and sign out.
struct SettingsView: View {
  @EnvironmentObject private var auth: AuthState
  @EnvironmentObject private var workspaces: WorkspaceState
  @Environment(\.scenePhase) private var scenePhase
  @AppStorage(TimeFormatPreference.defaultsKey) private var timeFormat: TimeFormatPreference = .auto
  @State private var saveError: String?
  /// The tapped value until the coordinator's optimistic flip lands, so the switch never snaps back for a frame.
  @State private var pendingRoomUnreadCount: Bool?
  @State private var notificationError: String?
  @State private var notificationAuthorization = ChatNotificationCenter.shared.authorization

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
      NotificationSettingsSection(
        kinds: workspaces.notificationPreferences.kinds,
        preset: workspaces.notificationPreferences.preset,
        reach: workspaces.notificationPreferences.reach(for:),
        isSaving: workspaces.notificationPreferences.isSaving,
        isAvailable: auth.isSignedIn && workspaces.notificationPreferences.isLoaded,
        bannersBlocked: workspaces.notificationPreferences.wantsBanner && notificationAuthorization == .denied,
        error: notificationError,
        onPreset: { preset in saveNotifications { try await workspaces.setNotificationPreset(preset, auth: auth) } },
        onReach: { kind, reach in saveNotifications { try await workspaces.setNotificationReach([kind: reach], auth: auth) } }
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
      notificationError = nil
      guard auth.isSignedIn else { return }
      await workspaces.refreshChatDisplayPreferences(auth: auth)
      if await !workspaces.refreshNotificationPreferences(auth: auth), !workspaces.notificationPreferences.isLoaded {
        notificationError = "Your notification settings did not load. Reopen Settings to try again."
      }
      await ChatNotificationCenter.shared.refreshAuthorization()
      notificationAuthorization = ChatNotificationCenter.shared.authorization
    }
    .task(id: scenePhase) {
      // Coming back from System Settings: pick up a permission change without reopening this window.
      guard scenePhase == .active else { return }
      await ChatNotificationCenter.shared.refreshAuthorization()
      notificationAuthorization = ChatNotificationCenter.shared.authorization
    }
  }

  /// The pickers show the model's optimistic value; a failure rolls it back there and is explained here.
  private func saveNotifications(_ write: @escaping @MainActor () async throws -> Void) {
    Task { @MainActor in
      notificationError = nil
      do {
        try await write()
      } catch {
        notificationError = "Could not save that change. Check your connection and try again."
      }
      notificationAuthorization = ChatNotificationCenter.shared.authorization
    }
  }

  /// The switch flips at once; `ChatDisplayPreferences` puts the previous
  /// value back when Core rejects the write (web `handleToggle`).
  private var showsRoomUnreadCount: Binding<Bool> {
    Binding {
      pendingRoomUnreadCount ?? workspaces.chatDisplay.showsRoomUnreadCount
    } set: { enabled in
      pendingRoomUnreadCount = enabled
      Task { @MainActor in
        // From here the model holds the value: optimistic on success, rolled back on failure.
        defer { pendingRoomUnreadCount = nil }
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
