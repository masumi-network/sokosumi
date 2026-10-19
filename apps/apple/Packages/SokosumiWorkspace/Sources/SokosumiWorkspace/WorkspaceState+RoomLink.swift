import SokosumiChat

public extension WorkspaceState {
  /// Navigate to a `ChatLink.room` within the current workspace. Membership-visible rooms remain the authority;
  /// invitation and guest-join links are presented by the app instead.
  @discardableResult
  func openRoomLink(roomId: String, messageId: String?) async throws -> MessageNavigationResult {
    guard rooms.contains(where: { $0.id == roomId }) else { return .unavailable }
    // A link, a notification or a Threads row shows its room in place of the Threads view (row 24f1).
    sidebar.showsThreadsView = false
    selectRoom(roomId)
    return try await openRoom.openLinkTarget(roomId: roomId, messageId: messageId)
  }
}
