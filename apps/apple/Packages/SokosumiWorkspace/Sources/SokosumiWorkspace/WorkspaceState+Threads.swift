import CoreAPI
import SokosumiChat

public extension WorkspaceState {
  internal func syncThreadAttention() async {
    guard readAttention.isVisible, !sidebar.showsThreadsView, roomHistoryReadable else { return }
    let parentId = openRoom.thread.parent?.id
    _ = try? await request { _, client, slug in
      guard try await openRoom.thread.markLooked(client: client, organizationSlug: slug), readAttention.isVisible else { return }
      openRoom.clearThreadUnreadReplies { $0 == parentId }
      try await syncRoomAttentionAfterThreadChange(client: client)
    }
  }

  /// The automatic Look inside the room read reached Core (row 24c): the Thread's reply bar and the Threads
  /// trigger drop it at once, and the trigger counts again.
  internal func threadLooked(_ parentMessageId: String?) {
    openRoom.clearThreadUnreadReplies { $0 == parentMessageId }
    openRoom.threadAttentionChanged()
  }

  /// A Look, a mute or Mark all moved this room's thread unread: re-count the Threads trigger and let Core's
  /// room read answer with the sidebar row's attention (web `bumpThreadUnread` + `syncRoomAttentionAfterThreadLook`).
  internal func syncRoomAttentionAfterThreadChange(client: Client) async throws {
    openRoom.threadAttentionChanged()
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
    openRoom.sendReply(content, sender: outboundSender, mentions: ComposerMention.selected(in: content, catalog: composerMentions),
                       attachments: attachments, quote: quote, skills: skills)
  }
}
