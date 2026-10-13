import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
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
