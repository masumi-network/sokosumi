import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  var streamingThreadToOpen: Components.Schemas.ChatRoomMessage? {
    guard openRoom.directStream.isBusy, openRoom.directStream.phase != .resuming,
          let parentId = openRoom.directStream.parentMessageId,
          openRoom.thread.parent?.id != parentId else { return nil }
    return transcriptMessages.first { $0.id == parentId }
  }

  func openThread(_ parent: Components.Schemas.ChatRoomMessage) {
    guard parent.roomId == transcriptRoomId else { return }
    let previousGeneration = openRoom.thread.transcript.timeline.generation
    guard openRoom.thread.open(parent) else { return }
    guard openRoom.thread.transcript.timeline.generation != previousGeneration else { return }
    loadThreadPage(.initial)
    let generation = openRoom.thread.transcript.timeline.generation
    openRoom.thread.transcript.recovery.start(foreground: readAttention.isVisible, healthy: openRoom.realtimeHealthy) { [weak self] in
      guard let self else { return }
      await openRoom.thread.transcript.whenIdle()
      guard generation == openRoom.thread.transcript.timeline.generation else { return }
      loadThreadPage(openRoom.thread.transcript.timeline.hasLoadedHistory ? .latest : .initial)
      await openRoom.thread.transcript.whenIdle()
    }
  }

  var displayedThreadReplies: [Components.Schemas.ChatRoomMessage] {
    let replies = openRoom.directStream.displayedMessages(persisted: openRoom.thread.transcript.displayedMessages, parentMessageId: openRoom.thread.parent?.id)
    return openRoom.loaded.pendingReactions.overlaying(replies, viewer: reactionViewer)
  }

  func loadThreadPage(_ page: RoomTimeline.Page) {
    guard page != .older || !openRoom.directStream.isBusy else { return }
    // The first page's Look comes before its request; later pages read the room after they land (`connectTranscripts`).
    openRoom.thread.transcript.load(page, before: page == .initial ? { [weak self] in
      guard let self else { return }
      await syncThreadAttention()
    } : nil)
  }

  internal func syncThreadAttention() async {
    guard readAttention.isVisible, !sidebar.showsThreadsView, roomHistoryReadable else { return }
    let parentId = openRoom.thread.parent?.id
    _ = try? await request { _, client, slug in
      guard try await openRoom.thread.markLooked(client: client, organizationSlug: slug), readAttention.isVisible else { return }
      clearThreadUnreadReplies { $0 == parentId }
      try await syncRoomAttentionAfterThreadChange(client: client)
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
    openRoom.threadOverview.clearUnreadReplies(where: isCleared)
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
    guard openRoom.thread.mute?.needsRead == true, openRoom.thread.parent?.roomId == transcriptRoomId else { return }
    _ = try? await request { _, client, slug in try await openRoom.thread.readMute(client: client, organizationSlug: slug) }
  }

  func toggleThreadMute() async {
    guard openRoom.thread.parent?.roomId == transcriptRoomId else { return }
    let roomId = transcriptRoomId
    _ = try? await request { _, client, slug in
      guard try await openRoom.thread.toggleMute(client: client, organizationSlug: slug), roomId == transcriptRoomId else { return }
      try await syncRoomAttentionAfterThreadChange(client: client)
    }
  }

  @discardableResult
  func sendThreadReply(_ content: String, attachments: [ComposeAttachment] = [], quote: Components.Schemas.ChatRoomMessageQuote? = nil,
                       skills: [Components.Schemas.ChatRoomMessageSkill] = []) -> Bool {
    guard let client = resolveClient(), openRoom.thread.parent?.roomId == transcriptRoomId else { return false }
    // Like the room's send: the reply joins the latest replies, so a jumped-to page ends.
    openRoom.thread.transcript.timeline.followLatest()
    if openRoom.directStream.roomId == transcriptRoomId, let parentId = openRoom.thread.parent?.id {
      let generation = openRoom.room.timeline.generation
      return openRoom.directStream.send(content, client: client, organizationSlug: selection?.workspace.organizationSlug,
                                        attachments: attachments, parentMessageId: parentId, quote: quote, settled: { [weak self] in
                                          guard let self else { return false }
                                          return await settleDirectStream(generation: generation)
                                        }, failed: { [weak self] error in
                                          guard let self, let error = error as? ChatServiceError else { return }
                                          signOutIfUnauthorized(error)
                                        })
    }
    return openRoom.thread.send(content, client: client, organizationSlug: selection?.workspace.organizationSlug, sender: outboundSender,
                                mentions: ComposerMention.selected(in: content, catalog: composerMentions), quote: quote,
                                skills: skills) { [weak self] result in
      guard let self else { return }
      switch result {
      case let .success(reply):
        // Web updates the room row. The open thread's parent is a snapshot, so assigning it would put back
        // an unread count a Look already cleared, before the unread read has answered.
        if let parentId = openRoom.thread.parent?.id {
          openRoom.room.update(parentId) { applyingReplyToParentThreadPreview($0, reply: reply) }
        }
      case let .failure(error):
        if let error = error as? ChatServiceError {
          signOutIfUnauthorized(error)
        }
      }
    }
  }
}
