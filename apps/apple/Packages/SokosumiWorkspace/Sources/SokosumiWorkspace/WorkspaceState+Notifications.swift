import CoreAPI
import Foundation
import SokosumiAuth
import SokosumiChat

enum ChatNotificationNavigationError: LocalizedError {
  case workspaceUnavailable

  var errorDescription: String? {
    "Could not switch to the workspace this notification belongs to."
  }
}

public extension WorkspaceState {
  /// Re-read the account's delivery matrix so a change made on web arrives.
  /// A failed read keeps the last known matrix and reports false.
  @discardableResult
  func refreshNotificationPreferences(auth: AuthState) async -> Bool {
    guard let client = resolveClient(auth: auth) else { return false }
    do {
      try await notificationPreferences.refresh(client: client)
      return true
    } catch {
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
      return false
    }
  }

  func setNotificationPreset(_ preset: ChatNotificationPreset, auth: AuthState) async throws {
    try await setNotificationReach(notificationPreferences.changes(for: preset), auth: auth)
  }

  /// Optimistic `PATCH /users/me/preferences`; the model rolls back on
  /// failure. A write that leaves a banner on asks the OS for permission
  /// first, which is where web asks the browser.
  func setNotificationReach(_ changes: [ChatNotificationKind: ChatNotificationReach], auth: AuthState) async throws {
    guard let client = resolveClient(auth: auth) else {
      throw ChatServiceError.unauthorized("Sign in to change notification preferences.")
    }
    let presenter = notificationPresenter
    do {
      try await notificationPreferences.setReach(changes, client: client) {
        _ = await presenter?.requestAuthorization()
      }
    } catch {
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
      throw error
    }
  }

  /// The reader opened a banner (web `useOpenNotification`): attempt to mark
  /// the row read, then route, switching workspace when the
  /// notification names another one. Navigation happens even if the read fails.
  @discardableResult
  func openNotification(_ target: ChatNotificationTarget, auth: AuthState) async throws -> MessageNavigationResult {
    notificationBanners.forget(roomId: target.roomId)
    // Web closes the banner on click; forget alone cannot dismiss the OS item.
    notificationPresenter?.dismiss(identifier: ChatNotificationEvent.bannerIdentifier(roomId: target.roomId))
    guard phase == .ready, let client = resolveClient(auth: auth) else { return .unavailable }
    // Still open the link when mark-read fails. Awaited rather than detached so requests keep one order.
    try? await ChatService().markNotificationRead(client: client, id: target.id)
    guard phase == .ready else { return .unavailable }
    if let workspaceId = target.workspaceId {
      try await switchWorkspaceIfNeeded(workspaceId: workspaceId, client: client, auth: auth)
      guard phase == .ready else { return .unavailable }
    }
    if !rooms.contains(where: { $0.id == target.roomId }) {
      // A room joined since the last sidebar read is not listed yet.
      await refreshRooms(auth: auth)
    }
    return try await openRoomLink(roomId: target.roomId, messageId: target.messageId, auth: auth)
  }
}

extension WorkspaceState {
  /// A failed lookup navigates without a switch; a failed switch does not
  /// navigate (web `handleNotificationNavigation`).
  private func switchWorkspaceIfNeeded(workspaceId: String, client: Client, auth: AuthState) async throws {
    let organizationId: String?
    do {
      // Nil is the personal workspace.
      organizationId = try await ChatService().workspaceOrganizationId(client: client, workspaceId: workspaceId)
    } catch {
      return
    }
    guard organizationId != selection?.workspace.organizationId else { return }
    guard let option = options.first(where: { $0.workspace.organizationId == organizationId }), !roomsLoading else {
      throw ChatNotificationNavigationError.workspaceUnavailable
    }
    await switchRooms(auth: auth, option: option)
    guard selectionId == option.id else { throw ChatNotificationNavigationError.workspaceUnavailable }
  }

  /// One event from the user notifications channel (web `NotificationToastListener`).
  func applyRealtimeNotification(_ event: ChatNotificationEvent) {
    guard let presenter = notificationPresenter else { return }
    // Web `document.hasFocus()`: natively the app is frontmost and a chat window is active.
    let focused = presenter.isAppActive && readAttention.isVisible
    switch notificationBanners.handle(event, isFocused: focused, authorization: presenter.authorization) {
    case .none: break
    case let .show(banner): presenter.show(banner)
    case let .dismiss(identifier): presenter.dismiss(identifier: identifier)
    }
  }

  /// Sign-out and quit: banners do not outlive the session that raised them.
  func clearNotificationBanners() {
    notificationBanners.removeAll()
    notificationPresenter?.dismissAll()
  }
}
