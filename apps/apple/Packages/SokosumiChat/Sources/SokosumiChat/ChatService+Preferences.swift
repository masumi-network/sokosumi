import CoreAPI

/// The account preferences both chat models read: unread-count display and
/// the notification matrix. User-scoped, so GET/PATCH carry no organization
/// header. Reads apply one snapshot onto both projections; writes stay
/// field-scoped so a display PATCH cannot clobber the matrix.
struct UserPreferencesSnapshot: Equatable, Sendable {
  var showRoomUnreadCount: Bool
  var pushOptIn: Bool
  var cells: [Components.Schemas.NotificationPreference]
}

extension ChatService {
  /// `GET /users/me/preferences`.
  func userPreferences(client: Client) async throws -> UserPreferencesSnapshot {
    let value = try await call { try await client.getUsersIdPreferences(.init(path: .init(id: "me"))) }.ok
    let data = try value.body.json.data
    return .init(
      showRoomUnreadCount: data.showRoomUnreadCount,
      pushOptIn: data.pushOptIn,
      cells: data.notificationPreferences
    )
  }

  /// `PATCH /users/me/preferences` with only the fields the caller changed.
  /// Nil fields stay omitted so a display write cannot clobber the matrix.
  func updateUserPreferences(
    client: Client,
    showRoomUnreadCount: Bool? = nil,
    pushOptIn: Bool? = nil,
    notificationPreferences: [Components.Schemas.NotificationPreference]? = nil
  ) async throws -> UserPreferencesSnapshot {
    let value = try await call {
      try await client.patchUsersIdPreferences(.init(
        path: .init(id: "me"),
        body: .json(.init(
          pushOptIn: pushOptIn,
          showRoomUnreadCount: showRoomUnreadCount,
          notificationPreferences: notificationPreferences
        ))
      ))
    }.ok
    let data = try value.body.json.data
    return .init(
      showRoomUnreadCount: data.showRoomUnreadCount,
      pushOptIn: data.pushOptIn,
      cells: data.notificationPreferences
    )
  }
}

public extension ChatService {
  /// One `GET /users/me/preferences` applied onto both chat projections.
  @MainActor
  func refreshUserPreferences(
    display: ChatDisplayPreferences,
    notifications: ChatNotificationPreferences,
    client: Client
  ) async throws {
    let displayRequest = display.beginRefresh()
    let notificationRequest = notifications.beginRefresh()
    let snapshot = try await userPreferences(client: client)
    display.apply(snapshot, request: displayRequest)
    notifications.apply(snapshot, request: notificationRequest)
  }
}
