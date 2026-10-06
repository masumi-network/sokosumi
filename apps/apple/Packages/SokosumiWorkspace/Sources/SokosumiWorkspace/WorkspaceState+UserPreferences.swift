import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  /// One `GET /users/me/preferences` applied onto display and notification
  /// projections. A failed read keeps both last known values and reports false.
  @discardableResult
  func refreshUserPreferences(auth: AuthState) async -> Bool {
    guard let client = resolveClient(auth: auth) else { return false }
    do {
      try await ChatService().refreshUserPreferences(
        display: chatDisplay,
        notifications: notificationPreferences,
        client: client
      )
      return true
    } catch {
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
      return false
    }
  }
}
