import CoreAPI
import SokosumiChat

public extension WorkspaceState {
  enum ThreadOverviewAction { case load, older, count, markAllRead }

  func updateThreadOverview(_ action: ThreadOverviewAction, roomId: String) async {
    guard roomId == transcriptRoomId else { return }
    let mentions = rooms.first(where: { $0.id == roomId }).map(MessageMentions.init)
    _ = try? await request { _, client, slug in
      switch action {
      case .load, .older:
        try await openRoom.threadOverview.load(client: client, roomId: roomId, organizationSlug: slug, older: action == .older, mentions: mentions)
      case .count:
        try await openRoom.threadOverview.refreshCount(client: client, roomId: roomId, organizationSlug: slug)
      case .markAllRead:
        try await openRoom.threadOverview.markAllRead(client: client, roomId: roomId, organizationSlug: slug, mentions: mentions) {
          // Web's `onAllThreadsLooked` voids its room read: a failed one never fails Mark all.
          guard roomId == transcriptRoomId else { return }
          let stillUnread = openRoom.threadOverview.mutedUnreadParentIds
          openRoom.clearThreadUnreadReplies { !stillUnread.contains($0) }
          do {
            try await syncRoomAttentionAfterThreadChange(client: client)
          } catch {
            if let error = error as? ChatServiceError {
              signOutIfUnauthorized(error)
            }
          }
        }
      }
    }
  }
}
