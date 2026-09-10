import CoreAPI
import SokosumiAuth
import SokosumiChat

extension WorkspaceState {
  var streamingThreadToOpen: Components.Schemas.ChatRoomMessage? {
    guard directStream.isBusy, directStream.phase != .resuming,
          let parentId = directStream.parentMessageId,
          thread.parent?.id != parentId else { return nil }
    return transcriptMessages.first { $0.id == parentId }
  }

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

  var displayedThreadReplies: [Components.Schemas.ChatRoomMessage] {
    directStream.displayedMessages(persisted: thread.displayedReplies, parentMessageId: thread.parent?.id)
  }

  func loadThreadPage(_ page: RoomTimeline.Page, auth: AuthState) {
    guard page != .older || !directStream.isBusy else { return }
    guard let client = resolveClient(auth: auth) else {
      thread.timeline.failInitialLoad(message: "Sign-in is not configured.", generation: thread.timeline.generation)
      return
    }
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
    guard readAttention.isVisible, roomHistoryReadable,
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
    if directStream.roomId == transcriptRoomId, let parentId = thread.parent?.id {
      let generation = timeline.generation
      return directStream.send(content, client: client, organizationSlug: selection?.workspace.organizationSlug,
                               parentMessageId: parentId, settled: { [weak self, weak auth] in
                                 guard let self, let auth else { return false }
                                 return await settleDirectStream(auth: auth, generation: generation)
                               }, failed: { [weak self, weak auth] error in
                                 guard let self, let auth, let error = error as? ChatServiceError else { return }
                                 signOutIfUnauthorized(error, auth: auth)
                               })
    }
    return thread.send(content, client: client, organizationSlug: selection?.workspace.organizationSlug, sender: outboundSender) { [weak self, weak auth] result in
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
