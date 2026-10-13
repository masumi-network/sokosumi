import CoreAPI
import Foundation

/// A failed mention shell's retry, keyed by the visit it started in.
struct MentionRetry: Hashable {
  let generation: Int
  let shellId: String
}

/// What the reader does to the open room's messages on Core. Each runs through `request`, so an answer that comes
/// back after the room changed moves nothing on screen.
public extension OpenRoomSession {
  // MARK: - Attachments

  /// Every attachment ingress (drop, paste, picker, Drive) asks this; Core refuses uploads to a Read-only Direct.
  func canAttachFiles(roomId: String) -> Bool {
    room.timeline.roomId == roomId && !room.timeline.isLoading && roomTakesNewMessages(hooks.listedRoom())
  }

  func driveItems(folder: String, query: String, roomId: String) async throws -> [Components.Schemas.DriveItem] {
    guard canAttachFiles(roomId: roomId) else {
      throw ChatServiceError.unexpectedResponse("Attachments are not available in this conversation.")
    }
    let organizationId = hooks.organizationId()
    guard let items = try await request(signIn: "Attachments are not available in this conversation.", { service, client, _ in
      try await service.driveItems(client: client, organizationId: organizationId, folder: folder, query: query)
    }) else { throw CancellationError() }
    return items
  }

  func uploadAttachment(_ file: URL, roomId: String) async throws -> ComposeAttachment {
    guard canAttachFiles(roomId: roomId) else {
      throw ChatServiceError.unexpectedResponse("Attachments are not available in this conversation.")
    }
    let scoped = file.startAccessingSecurityScopedResource()
    defer {
      if scoped {
        file.stopAccessingSecurityScopedResource()
      }
    }
    let resource = try file.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
    guard resource.isRegularFile == true, let size = resource.fileSize else { throw AttachmentUpload.Failure.invalidFile }
    try AttachmentUpload.validate(size: size)
    let contentType = try AttachmentUpload.contentType(filename: file.lastPathComponent)
    let visit = room.timeline.generation
    guard let attachment = try await request(signIn: "Attachments are not available in this conversation.", { service, client, slug in
      let grant = try await service.attachmentGrant(client: client, roomId: roomId, file: .init(filename: file.lastPathComponent, contentType: contentType, size: size), organizationSlug: slug)
      // The grant belongs to this visit; a room change before it arrives uploads nothing.
      try Task.checkCancellation()
      guard visit == room.timeline.generation else { throw CancellationError() }
      return try await AttachmentUpload.put(file: file, filename: file.lastPathComponent, contentType: contentType, size: size, grant: grant)
    }) else { throw CancellationError() }
    return attachment
  }

  // MARK: - Deleting and editing

  func deleteMessage(_ source: Components.Schemas.ChatRoomMessage) async throws {
    guard source.roomId == room.timeline.roomId, source.deletedAt == nil else { return }
    let parentId = source.parentMessageId
    let parentCount = parentId.flatMap { id in
      thread.parent?.id == id ? thread.parent?.threadReplyCount : room.timeline.messages.first { $0.id == id }?.threadReplyCount
    }
    guard let message = try await request(signIn: "Log in to delete messages.", { service, client, slug in
      try await service.deleteMessage(client: client, roomId: source.roomId, messageId: source.id, organizationSlug: slug)
    }), message.roomId == room.timeline.roomId else { return }
    loaded.apply(eventType: .delete, message: message)
    if messageEditing.source?.id == message.id {
      messageEditing.reset()
    }
    if message.deletedAt != nil, let parentId, let parentCount {
      loaded.update(parentId) { applyingReplyDeletion(to: $0, parentId: parentId, previousReplyCount: parentCount) }
    }
  }

  func startEditing(_ message: Components.Schemas.ChatRoomMessage) {
    guard message.roomId == room.timeline.roomId else { return }
    messageEditing.start(message, userId: hooks.viewerId())
  }

  /// The editor keeps its own failure to show; a rejected session also signs out.
  func saveEdit() async {
    guard let saved = try? await request(signIn: "Log in again.", { _, client, slug in
      try await messageEditing.save(client: client, organizationSlug: slug)
    }), let message = saved, message.roomId == room.timeline.roomId else { return }
    loaded.apply(eventType: .update, message: message)
  }

  func removeUnfurl(_ source: Components.Schemas.ChatRoomMessage, url: String) async throws {
    guard source.roomId == room.timeline.roomId, canModifyOwnMessage(source, userId: hooks.viewerId()) else { return }
    guard try await request(signIn: "Log in to remove link previews.", { service, client, slug in
      try await service.removeUnfurl(client: client, roomId: source.roomId, messageId: source.id, url: url, organizationSlug: slug)
    }) != nil else { return }
    // Remove only this URL: a full response could overwrite a newer edit or another removal.
    loaded.update(source.id) { message in
      guard message.id == source.id, message.deletedAt == nil else { return message }
      var updated = message
      updated.unfurls = message.unfurls?.filter { $0.url != url }
      return updated
    }
  }

  // MARK: - Mentions

  /// Retry is offered to the mentioner only, and only while the source human message is loaded in the room or the
  /// open Thread (web `mentionRetrySourceMessages`).
  func canRetryMention(_ shell: Components.Schemas.ChatRoomMessage) -> Bool {
    // Ordinary rows reach this while scrolling; reject them before copying the transcript.
    guard shell.roomId == room.timeline.roomId,
          case .failed(_, _?) = MentionThoughtShell(message: shell) else { return false }
    return MentionThoughtShell.canRetry(shell, currentUserId: hooks.viewerId(), sources: loaded.all)
  }

  /// Flips the failed shell back to a live Thought, then `POST …/mentions/{mentionId}/retry`. Success merges the
  /// returned source message (mentions reset to pending); the shell's own progress returns over realtime. Any
  /// failure restores the failed shell and rethrows so the row can show Core's reason.
  func retryMention(_ shell: Components.Schemas.ChatRoomMessage, now: Date) async throws {
    guard shell.roomId == room.timeline.roomId,
          case let .failed(mentionId, sourceMessageId?) = MentionThoughtShell(message: shell) else { return }
    let retry = MentionRetry(generation: room.timeline.generation, shellId: shell.id)
    guard pendingMentionRetries.insert(retry).inserted else { return }
    defer { pendingMentionRetries.remove(retry) }
    replaceLoaded(MentionThoughtShell.retrying(shell, startedAt: now))
    do {
      guard let source = try await request(signIn: "Log in to retry mentions.", { service, client, slug in
        try await service.retryMention(client: client, roomId: shell.roomId, messageId: sourceMessageId, mentionId: mentionId,
                                       organizationSlug: slug)
      }) else { return }
      replaceLoaded(source)
    } catch {
      replaceLoaded(shell)
      throw error
    }
  }

  // MARK: - Reactions

  /// Shows the tap at once and tells Core the end state (ADR 0032); see `LoadedMessages.toggleReaction`. Returns
  /// whether this call's requests ended with the viewer's reaction on the message. Pending reactions outlive the
  /// room, so a tap still settles and reports after the reader leaves it.
  @discardableResult
  func toggleReaction(_ source: Components.Schemas.ChatRoomMessage, emoji: String) async throws -> Bool {
    guard source.roomId == room.timeline.roomId, canReactToMessage(source) else { return false }
    return try await request(signIn: "Log in to react to messages.", outlivingTheVisit: true) { _, client, slug in
      try await loaded.toggleReaction(source, emoji: emoji, client: client, organizationSlug: slug)
    } ?? false
  }

  // MARK: - Pins

  var canUsePins: Bool {
    hooks.listedRoom()?.kind == .channel
  }

  func isPinned(_ message: Components.Schemas.ChatRoomMessage) -> Bool {
    guard message.deletedAt == nil else { return false }
    return room.timeline.pinOverrides[message.id] ?? (message.pinnedAt != nil)
  }

  func isUpdatingPin(_ messageId: String) -> Bool {
    pendingPins.contains(messageId)
  }

  func loadPins(older: Bool = false) async throws {
    guard canUsePins else { return }
    _ = try await request(signIn: "Log in to view pinned messages.") { _, client, slug in
      try await pins.load(client: client, organizationSlug: slug, older: older)
    }
  }

  /// Pins or unpins `messageId`, one change per message at a time, and returns the room's pin count for the sidebar.
  /// Nil when nothing changed here: the room changed meanwhile, or a live event already moved the pin.
  @discardableResult
  func setPinned(_ pinned: Bool, messageId: String) async throws -> Int? {
    guard canUsePins, let roomId = room.timeline.roomId, pendingPins.insert(messageId).inserted else { return nil }
    let generation = room.timeline.generation
    let revision = pins.revision
    defer {
      if generation == room.timeline.generation {
        pendingPins.remove(messageId)
      }
    }
    guard let response = try await request(signIn: "Log in to update pinned messages.", { service, client, slug in
      try await pinned
        ? service.pinMessage(client: client, roomId: roomId, messageId: messageId, organizationSlug: slug)
        : service.unpinMessage(client: client, roomId: roomId, messageId: messageId, organizationSlug: slug)
    }) else { return nil }
    // A live event may already carry a newer count or opposite action.
    guard revision == pins.revision else {
      pins.invalidate()
      return nil
    }
    // The same change a live pin event makes (one reducer for both).
    applyPin(roomId: roomId, messageId: messageId, isPinned: pinned)
    return response.pinnedMessageCount
  }

  // MARK: - Finding a message

  /// Lands on `messageId`: at once when the room shows it, else after loading the page around it.
  func jumpToMessage(_ messageId: String) async throws -> Bool {
    if directStream.displayedMessages(persisted: room.displayedMessages).contains(where: { $0.id == messageId }) {
      return true
    }
    guard hooks.access() != nil else {
      throw ChatServiceError.unauthorized("Log in to view this message.")
    }
    return try await room.loadAround(messageId)
  }

  func searchMessages(_ query: String, roomId: String, search: RoomSearch) async {
    guard roomId == room.timeline.roomId else {
      search.reset()
      return
    }
    guard let access = hooks.access() else {
      search.fail(ChatServiceError.unauthorized("Log in to search messages."), query: query)
      return
    }
    let visit = room.timeline.generation
    await search.search(query: query, roomId: roomId, client: access.client, organizationSlug: access.organizationSlug)
    guard visit == room.timeline.generation else { return }
    if let error = search.failure as? ChatServiceError {
      _ = hooks.failed(error)
    }
  }
}

private extension OpenRoomSession {
  /// Update-only: a row that is not loaded stays absent, unlike a realtime create.
  func replaceLoaded(_ message: Components.Schemas.ChatRoomMessage) {
    loaded.update(message.id) { _ in message }
  }
}
