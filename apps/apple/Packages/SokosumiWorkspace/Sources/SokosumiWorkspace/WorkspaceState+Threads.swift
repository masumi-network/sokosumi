import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  var streamingThreadToOpen: Components.Schemas.ChatRoomMessage? {
    guard directStream.isBusy, directStream.phase != .resuming,
          let parentId = directStream.parentMessageId,
          thread.parent?.id != parentId else { return nil }
    return transcriptMessages.first { $0.id == parentId }
  }

  func openThread(_ parent: Components.Schemas.ChatRoomMessage, auth: AuthState) {
    guard parent.roomId == transcriptRoomId else { return }
    let previousGeneration = thread.transcript.timeline.generation
    guard thread.open(parent) else { return }
    guard thread.transcript.timeline.generation != previousGeneration else { return }
    loadThreadPage(.initial, auth: auth)
    let generation = thread.transcript.timeline.generation
    thread.transcript.recovery.start(foreground: readAttention.isVisible, healthy: transcriptRealtimeHealthy) { [weak self, weak auth] in
      guard let self, let auth else { return }
      await thread.transcript.whenIdle()
      guard generation == thread.transcript.timeline.generation else { return }
      loadThreadPage(thread.transcript.timeline.hasLoadedHistory ? .latest : .initial, auth: auth)
      await thread.transcript.whenIdle()
    }
  }

  var displayedThreadReplies: [Components.Schemas.ChatRoomMessage] {
    let replies = directStream.displayedMessages(persisted: thread.transcript.displayedMessages, parentMessageId: thread.parent?.id)
    return pendingReactions.overlaying(replies, viewer: reactionViewer)
  }

  func loadThreadPage(_ page: RoomTimeline.Page, auth: AuthState) {
    guard page != .older || !directStream.isBusy else { return }
    // The first page's Look comes before its request; later pages read the room after they land.
    thread.transcript.hooks = transcriptHooks(auth: auth) { [weak self, weak auth] page in
      guard let self, let auth, page != .initial else { return }
      await syncReadAttention(auth: auth)
    }
    thread.transcript.load(page, before: page == .initial ? { [weak self, weak auth] in
      guard let self, let auth else { return }
      await syncThreadAttention(auth: auth)
    } : nil)
  }

  internal func syncThreadAttention(auth: AuthState) async {
    guard readAttention.isVisible, !sidebar.showsThreadsView, roomHistoryReadable,
          let client = resolveClient(auth: auth) else { return }
    let parentId = thread.parent?.id
    do {
      guard try await thread.markLooked(client: client, organizationSlug: selection?.workspace.organizationSlug),
            readAttention.isVisible else { return }
      clearThreadUnreadReplies { $0 == parentId }
      try await syncRoomAttentionAfterThreadChange(client: client)
    } catch {
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
    }
  }

  /// The automatic Look inside the room read reached Core (row 24c): the Thread's reply bar and the Threads
  /// trigger drop it at once, and the trigger counts again.
  internal func threadLooked(_ parentMessageId: String?) {
    clearThreadUnreadReplies { $0 == parentMessageId }
    threadAttentionRevision += 1
  }

  /// Web's `clearThreadUnreadReplies`: a Look or Mark all settles the Threads trigger and the transcript's reply
  /// bars without waiting for the re-read the caller also starts (row 24h, SOK-1151).
  internal func clearThreadUnreadReplies(where isCleared: (String) -> Bool) {
    threadOverview.clearUnreadReplies(where: isCleared)
    transcriptMessages = clearingThreadUnreadReplies(transcriptMessages, where: isCleared)
  }

  /// A Look, a mute or Mark all moved this room's thread unread: re-count the Threads trigger and let Core's
  /// room read answer with the sidebar row's attention (web `bumpThreadUnread` + `syncRoomAttentionAfterThreadLook`).
  internal func syncRoomAttentionAfterThreadChange(client: Client) async throws {
    threadAttentionRevision += 1
    guard roomHistoryReadable, let room = rooms.first(where: { $0.id == transcriptRoomId }) else { return }
    try await readAttention.readAfterThreadLook(
      room: room, client: client, organizationSlug: selection?.workspace.organizationSlug
    )
  }

  /// Web's `ThreadMuteButton` reads the open thread's mute itself, because a thread opened from a message
  /// row has no overview behind it. Runs only while the state is unknown; the view calls it again when the
  /// reply count changes, so a parent's first reply brings the control.
  func readThreadMuteIfNeeded(auth: AuthState) async {
    guard thread.mute?.needsRead == true, thread.parent?.roomId == transcriptRoomId,
          let client = resolveClient(auth: auth) else { return }
    do {
      try await thread.readMute(client: client, organizationSlug: selection?.workspace.organizationSlug)
    } catch {
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
    }
  }

  func toggleThreadMute(auth: AuthState) async {
    guard thread.parent?.roomId == transcriptRoomId, let client = resolveClient(auth: auth) else { return }
    let roomId = transcriptRoomId
    do {
      guard try await thread.toggleMute(client: client, organizationSlug: selection?.workspace.organizationSlug),
            roomId == transcriptRoomId else { return }
      try await syncRoomAttentionAfterThreadChange(client: client)
    } catch {
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
    }
  }

  @discardableResult
  func sendThreadReply(_ content: String, attachments: [ComposeAttachment] = [], quote: Components.Schemas.ChatRoomMessageQuote? = nil,
                       skills: [Components.Schemas.ChatRoomMessageSkill] = [], auth: AuthState) -> Bool {
    guard let client = resolveClient(auth: auth), thread.parent?.roomId == transcriptRoomId else { return false }
    if directStream.roomId == transcriptRoomId, let parentId = thread.parent?.id {
      let generation = room.timeline.generation
      return directStream.send(content, client: client, organizationSlug: selection?.workspace.organizationSlug,
                               attachments: attachments, parentMessageId: parentId, quote: quote, settled: { [weak self, weak auth] in
                                 guard let self, let auth else { return false }
                                 return await settleDirectStream(auth: auth, generation: generation)
                               }, failed: { [weak self, weak auth] error in
                                 guard let self, let auth, let error = error as? ChatServiceError else { return }
                                 signOutIfUnauthorized(error, auth: auth)
                               })
    }
    return thread.send(content, client: client, organizationSlug: selection?.workspace.organizationSlug, sender: outboundSender,
                       mentions: ComposerMention.selected(in: content, catalog: composerMentions), quote: quote,
                       skills: skills) { [weak self, weak auth] result in
      guard let self, let auth else { return }
      switch result {
      case let .success(reply):
        // Web updates the room row. The open thread's parent is a snapshot, so assigning it would put back
        // an unread count a Look already cleared, before the unread read has answered.
        if let parentId = thread.parent?.id, let index = transcriptMessages.firstIndex(where: { $0.id == parentId }) {
          transcriptMessages[index] = applyingReplyToParentThreadPreview(transcriptMessages[index], reply: reply)
        }
      case let .failure(error):
        if let error = error as? ChatServiceError {
          signOutIfUnauthorized(error, auth: auth)
        }
      }
    }
  }
}
