import CoreAPI
import Foundation

/// What the open room shows: its rows and the open Thread's, with the reader's Pending reactions and the Thread
/// overview's reply counts on top.
public extension OpenRoomSession {
  /// Confirmed history plus unresolved outbound shells (sticky at the end), with Pending reactions on top.
  var displayedTranscript: [Components.Schemas.ChatRoomMessage] {
    let rows = loaded.pendingReactions.overlaying(roomRows, viewer: reactionViewer)
    // Once the room's unread-thread read has answered it owns every reply bar's count (web, SOK-1151).
    return threadOverview.unreadReplyCounts.map { applyThreadUnreadReplyCounts(rows, counts: $0) } ?? rows
  }

  /// The open Thread's replies with the reader's Pending reactions on top.
  var displayedThreadReplies: [Components.Schemas.ChatRoomMessage] {
    loaded.pendingReactions.overlaying(replyRows, viewer: reactionViewer)
  }

  /// The open Thread's parent with the reader's Pending reactions on top.
  var displayedThreadParent: Components.Schemas.ChatRoomMessage? {
    thread.parent.map { loaded.pendingReactions.overlaying($0, viewer: reactionViewer) }
  }

  /// Web's `clearThreadUnreadReplies`: a Look or Mark all settles the Threads trigger and the room's reply bars
  /// without waiting for the re-read the caller also starts (row 24h, SOK-1151).
  func clearThreadUnreadReplies(where isCleared: (String) -> Bool) {
    threadOverview.clearUnreadReplies(where: isCleared)
    room.timeline.messages = clearingThreadUnreadReplies(room.timeline.messages, where: isCleared)
  }

  /// The room's rows as it shows them: history plus the coworker stream's overlay, before Pending reactions.
  internal var roomRows: [Components.Schemas.ChatRoomMessage] {
    directStream.displayedMessages(persisted: room.displayedMessages)
  }

  /// The open Thread's replies as it shows them, before Pending reactions.
  internal var replyRows: [Components.Schemas.ChatRoomMessage] {
    directStream.displayedMessages(persisted: thread.transcript.displayedMessages, parentMessageId: thread.parent?.id)
  }
}

extension OpenRoomSession {
  /// Listed among the reactors under the name the open room gives the reader, else their account name.
  var reactionViewer: PendingReactionViewer {
    let viewer = hooks.viewer()
    let name = hooks.listedRoom()?.userMembers.first { $0.id == viewer.id }?.name ?? viewer.name
    return .init(id: viewer.id, name: name.isEmpty ? nil : name)
  }
}
