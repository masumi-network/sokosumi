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

  func openThread(_ parent: Components.Schemas.ChatRoomMessage) {
    guard parent.roomId == transcriptRoomId else { return }
    let previousGeneration = thread.transcript.timeline.generation
    guard thread.open(parent) else { return }
    guard thread.transcript.timeline.generation != previousGeneration else { return }
    loadThreadPage(.initial)
    let generation = thread.transcript.timeline.generation
    thread.transcript.recovery.start(foreground: readAttention.isVisible, healthy: transcriptRealtimeHealthy) { [weak self] in
      guard let self else { return }
      await thread.transcript.whenIdle()
      guard generation == thread.transcript.timeline.generation else { return }
      loadThreadPage(thread.transcript.timeline.hasLoadedHistory ? .latest : .initial)
      await thread.transcript.whenIdle()
    }
  }

  var displayedThreadReplies: [Components.Schemas.ChatRoomMessage] {
    let replies = directStream.displayedMessages(persisted: thread.transcript.displayedMessages, parentMessageId: thread.parent?.id)
    return loaded.pendingReactions.overlaying(replies, viewer: reactionViewer)
  }

  func loadThreadPage(_ page: RoomTimeline.Page) {
    guard page != .older || !directStream.isBusy else { return }
    // The first page's Look comes before its request; later pages read the room after they land.
    thread.transcript.hooks = transcriptHooks { [weak self] page in
      guard let self, page != .initial else { return }
      await syncReadAttention()
    }
    thread.transcript.load(page, before: page == .initial ? { [weak self] in
      guard let self else { return }
      await syncThreadAttention()
    } : nil)
  }

  internal func syncThreadAttention() async {
    guard readAttention.isVisible, !sidebar.showsThreadsView, roomHistoryReadable,
          let client = resolveClient() else { return }
    let parentId = thread.parent?.id
    do {
      guard try await thread.markLooked(client: client, organizationSlug: selection?.workspace.organizationSlug),
            readAttention.isVisible else { return }
      clearThreadUnreadReplies { $0 == parentId }
      try await syncRoomAttentionAfterThreadChange(client: client)
    } catch {
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error)
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
  func readThreadMuteIfNeeded() async {
    guard thread.mute?.needsRead == true, thread.parent?.roomId == transcriptRoomId,
          let client = resolveClient() else { return }
    do {
      try await thread.readMute(client: client, organizationSlug: selection?.workspace.organizationSlug)
    } catch {
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error)
      }
    }
  }

  func toggleThreadMute() async {
    guard thread.parent?.roomId == transcriptRoomId, let client = resolveClient() else { return }
    let roomId = transcriptRoomId
    do {
      guard try await thread.toggleMute(client: client, organizationSlug: selection?.workspace.organizationSlug),
            roomId == transcriptRoomId else { return }
      try await syncRoomAttentionAfterThreadChange(client: client)
    } catch {
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error)
      }
    }
  }

  @discardableResult
  func sendThreadReply(_ content: String, attachments: [ComposeAttachment] = [], quote: Components.Schemas.ChatRoomMessageQuote? = nil,
                       skills: [Components.Schemas.ChatRoomMessageSkill] = []) -> Bool {
    guard let client = resolveClient(), thread.parent?.roomId == transcriptRoomId else { return false }
    if directStream.roomId == transcriptRoomId, let parentId = thread.parent?.id {
      let generation = room.timeline.generation
      return directStream.send(content, client: client, organizationSlug: selection?.workspace.organizationSlug,
                               attachments: attachments, parentMessageId: parentId, quote: quote, settled: { [weak self] in
                                 guard let self else { return false }
                                 return await settleDirectStream(generation: generation)
                               }, failed: { [weak self] error in
                                 guard let self, let error = error as? ChatServiceError else { return }
                                 signOutIfUnauthorized(error)
                               })
    }
    return thread.send(content, client: client, organizationSlug: selection?.workspace.organizationSlug, sender: outboundSender,
                       mentions: ComposerMention.selected(in: content, catalog: composerMentions), quote: quote,
                       skills: skills) { [weak self] result in
      guard let self else { return }
      switch result {
      case let .success(reply):
        // Web updates the room row. The open thread's parent is a snapshot, so assigning it would put back
        // an unread count a Look already cleared, before the unread read has answered.
        if let parentId = thread.parent?.id {
          room.update(parentId) { applyingReplyToParentThreadPreview($0, reply: reply) }
        }
      case let .failure(error):
        if let error = error as? ChatServiceError {
          signOutIfUnauthorized(error)
        }
      }
    }
  }
}
