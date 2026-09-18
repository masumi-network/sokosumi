import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  enum ThreadOverviewAction { case load, older, count, markAllRead }

  func updateThreadOverview(_ action: ThreadOverviewAction, roomId: String, auth: AuthState) async {
    guard roomId == transcriptRoomId, let client = resolveClient(auth: auth) else { return }
    let generation = timeline.generation
    let slug = selection?.workspace.organizationSlug
    do {
      switch action {
      case .load, .older:
        try await threadOverview.load(client: client, roomId: roomId, organizationSlug: slug, older: action == .older, mentions: rooms.first(where: { $0.id == roomId }).map(MessageMentions.init))
      case .count:
        try await threadOverview.refreshCount(client: client, roomId: roomId, organizationSlug: slug)
      case .markAllRead:
        try await threadOverview.markAllRead(client: client, roomId: roomId, organizationSlug: slug, mentions: rooms.first(where: { $0.id == roomId }).map(MessageMentions.init))
      }
    } catch {
      guard generation == timeline.generation, !Task.isCancelled else { return }
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
    }
  }
}
