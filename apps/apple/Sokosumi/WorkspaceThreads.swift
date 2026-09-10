import CoreAPI
import SokosumiAuth
import SokosumiChat

extension WorkspaceState {
  func openThread(_ parent: Components.Schemas.ChatRoomMessage, auth: AuthState) {
    guard parent.roomId == transcriptRoomId, thread.open(parent) else { return }
    loadThreadPage(.initial, auth: auth)
    let generation = thread.timeline.generation
    thread.recovery.start(foreground: readAttention.isVisible, healthy: transcriptRealtimeHealthy) { [weak self, weak auth] in
      guard let self, let auth else { return }
      while let task = thread.loadTask, generation == thread.timeline.generation {
        await task.value
      }
      guard generation == thread.timeline.generation else { return }
      guard readAttention.isVisible else {
        thread.recovery.requestRefresh()
        return
      }
      loadThreadPage(thread.timeline.hasLoadedHistory ? .latest : .initial, auth: auth)
      await thread.loadTask?.value
    }
  }

  func loadThreadPage(_ page: RoomTimeline.Page, auth: AuthState) {
    guard let client = resolveClient(auth: auth) else { return }
    thread.loadPage(page, client: client, organizationSlug: selection?.workspace.organizationSlug,
                    syncAttention: { [weak self, weak auth] in
                      guard let self, let auth else { return }
                      if page == .initial {
                        await syncThreadAttention(auth: auth)
                      } else {
                        await syncReadAttention(auth: auth)
                      }
                    }, failed: { [weak self, weak auth] error in
                      guard let self, let auth, let error = error as? ChatServiceError else { return }
                      signOutIfUnauthorized(error, auth: auth)
                    })
  }

  func syncThreadAttention(auth: AuthState) async {
    guard readAttention.isVisible, timeline.hasLoadedHistory, timeline.failedPage == nil,
          let client = resolveClient(auth: auth) else { return }
    do {
      guard try await thread.markLooked(client: client, organizationSlug: selection?.workspace.organizationSlug),
            readAttention.isVisible else { return }
      guard let room = rooms.first(where: { $0.id == transcriptRoomId }) else { return }
      try await readAttention.readAfterThreadLook(
        room: room, client: client, organizationSlug: selection?.workspace.organizationSlug
      )
    } catch {
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
    }
  }

  @discardableResult
  func sendThreadReply(_ content: String, auth: AuthState) -> Bool {
    guard let client = resolveClient(auth: auth), thread.parent?.roomId == transcriptRoomId else { return false }
    let sender = Components.Schemas.ChatRoomUserParticipant(
      id: currentUserId, name: currentUserName, email: currentUserEmail, image: currentUserImageURL, presence: .online
    )
    return thread.send(content, client: client, organizationSlug: selection?.workspace.organizationSlug, sender: sender) { [weak self, weak auth] result in
      guard let self, let auth else { return }
      switch result {
      case .success:
        if let parent = thread.parent, let index = transcriptMessages.firstIndex(where: { $0.id == parent.id }) {
          transcriptMessages[index] = parent
        }
      case let .failure(error):
        if let error = error as? ChatServiceError {
          signOutIfUnauthorized(error, auth: auth)
        }
      }
    }
  }
}
