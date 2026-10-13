import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  /// One `GET /users/me/preferences` applied onto display and notification
  /// projections. A failed read keeps both last known values and reports false.
  @discardableResult
  func refreshUserPreferences() async -> Bool {
    guard let client = resolveClient() else { return false }
    do {
      try await ChatService().refreshUserPreferences(
        display: chatDisplay,
        notifications: notificationPreferences,
        client: client
      )
      return true
    } catch {
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error)
      }
      return false
    }
  }
}
