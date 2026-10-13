import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  /// Shows the tap at once and tells Core the end state (ADR 0032); see `LoadedMessages.toggleReaction`. Returns
  /// whether this call's requests ended with the viewer's reaction on the message.
  @discardableResult
  func toggleReaction(_ source: Components.Schemas.ChatRoomMessage, emoji: String) async throws -> Bool {
    guard source.roomId == transcriptRoomId, canReactToMessage(source) else { return false }
    return try await request(signIn: "Log in to react to messages.") { _, client, slug in
      try await openRoom.loaded.toggleReaction(source, emoji: emoji, client: client, organizationSlug: slug)
    }
  }

  /// The thread parent with the viewer's Pending reactions on top.
  var displayedThreadParent: Components.Schemas.ChatRoomMessage? {
    openRoom.thread.parent.map { openRoom.loaded.pendingReactions.overlaying($0, viewer: reactionViewer) }
  }
}

extension WorkspaceState {
  /// Listed among the reactors under the name the open room shows, else the account name.
  var reactionViewer: PendingReactionViewer {
    let roomName = rooms.first { $0.id == transcriptRoomId }?.userMembers.first { $0.id == currentUserId }?.name
    let name = roomName ?? currentUserName
    return .init(id: currentUserId, name: name.isEmpty ? nil : name)
  }
}
