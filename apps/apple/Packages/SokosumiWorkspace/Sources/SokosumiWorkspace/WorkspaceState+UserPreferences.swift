import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  /// One `GET /users/me/preferences` applied onto display and notification
  /// projections. A failed read keeps both last known values and reports false.
  @discardableResult
  func refreshUserPreferences() async -> Bool {
    do {
      try await request { service, client, _ in
        try await service.refreshUserPreferences(display: chatDisplay, notifications: notificationPreferences, client: client)
      }
      return true
    } catch {
      return false
    }
  }
}

public extension WorkspaceState {
  /// Re-read the account's chat display preferences so a change made on web
  /// or another device arrives. A failed read keeps the last known value.
  /// The preference is user-scoped, so a workspace switch does not invalidate
  /// it; `ChatDisplayPreferences.reset` drops results that outlive sign-out.
  func refreshChatDisplayPreferences() async {
    _ = try? await request { _, client, _ in try await chatDisplay.refresh(client: client) }
  }

  /// Optimistic `PATCH /users/me/preferences`; the model rolls back on
  /// failure. A 401 signs out like every other chat request; other errors
  /// rethrow so Settings can say the change was not saved.
  func setShowsRoomUnreadCount(_ enabled: Bool) async throws {
    try await request(signIn: "Log in to change chat display preferences.") { _, client, _ in
      try await chatDisplay.setShowsRoomUnreadCount(enabled, client: client)
    }
  }
}
