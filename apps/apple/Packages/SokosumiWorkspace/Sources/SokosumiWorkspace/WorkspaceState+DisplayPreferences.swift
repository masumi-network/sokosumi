import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  /// Re-read the account's chat display preferences so a change made on web
  /// or another device arrives. A failed read keeps the last known value.
  /// The preference is user-scoped, so a workspace switch does not invalidate
  /// it; `ChatDisplayPreferences.reset` drops results that outlive sign-out.
  func refreshChatDisplayPreferences(auth: AuthState) async {
    guard let client = resolveClient(auth: auth) else { return }
    do {
      try await chatDisplay.refresh(client: client)
    } catch {
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
    }
  }

  /// Optimistic `PATCH /users/me/preferences`; the model rolls back on
  /// failure. A 401 signs out like every other chat request; other errors
  /// rethrow so Settings can say the change was not saved.
  func setShowsRoomUnreadCount(_ enabled: Bool, auth: AuthState) async throws {
    guard let client = resolveClient(auth: auth) else {
      throw ChatServiceError.unauthorized("Sign in to change chat display preferences.")
    }
    do {
      try await chatDisplay.setShowsRoomUnreadCount(enabled, client: client)
    } catch {
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
      throw error
    }
  }
}
