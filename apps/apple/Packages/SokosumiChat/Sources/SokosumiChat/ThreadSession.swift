import Combine
import CoreAPI
import Foundation

/// One open thread. The parent is separate from replies so parent edits never
/// duplicate the root below the divider. Closing drops only local send state.
@MainActor
public final class ThreadSession: ObservableObject {
  public typealias Message = Components.Schemas.ChatRoomMessage

  @Published public private(set) var parent: Message?
  public let timeline = RoomTimeline()
  public let outbox = RoomOutbox()
  public let recovery = ChatRefreshScheduler()
  public private(set) var loadTask: Task<Void, Never>?
  private let service = ChatService()

  public init() {}

  public var displayedReplies: [Message] {
    displayedTranscript(messages: timeline.messages, shells: outbox.shells)
  }

  @discardableResult
  public func open(_ message: Message) -> Bool {
    guard message.parentMessageId == nil, !isOutboundLocalMessage(message) else { return false }
    if parent?.id == message.id {
      parent = message
      return true
    }
    close()
    parent = message
    timeline.reset(roomId: message.roomId, parentMessageId: message.id)
    return true
  }

  public func close() {
    loadTask?.cancel()
    loadTask = nil
    recovery.stop()
    outbox.reset()
    timeline.reset()
    parent = nil
  }

  /// Serialize page reads. Initial thread attention precedes the first GET;
  /// subsequent reads update attention after the new content is available.
  public func loadPage(
    _ page: RoomTimeline.Page, client: Client, organizationSlug: String?,
    syncAttention: @escaping () async -> Void, failed: @escaping (Error) -> Void
  ) {
    guard parent != nil, loadTask == nil else { return }
    let generation = timeline.generation
    loadTask = Task { [weak self] in
      guard let self, timeline.generation == generation else { return }
      defer {
        if timeline.generation == generation {
          loadTask = nil
        }
      }
      if page == .initial {
        await syncAttention()
      }
      guard timeline.generation == generation, !Task.isCancelled else { return }
      do {
        let loaded = try await timeline.loadPage(page, client: client, organizationSlug: organizationSlug, generation: generation)
        if loaded, page != .initial {
          await syncAttention()
        }
      } catch {
        guard timeline.generation == generation, !Task.isCancelled else { return }
        failed(error)
      }
    }
  }

  /// The caller performs its visibility-gated room read after this succeeds,
  /// before fetching replies, matching web's thread-look then room-read order.
  public func markLooked(client: Client, organizationSlug: String?) async throws -> Bool {
    guard let parent else { return false }
    let generation = timeline.generation
    _ = try await ChatService().markThreadRead(
      client: client, roomId: parent.roomId, parentMessageId: parent.id,
      organizationSlug: organizationSlug
    )
    return generation == timeline.generation && !Task.isCancelled
  }

  @discardableResult
  public func send(
    _ content: String, client: Client, organizationSlug: String?,
    sender: Components.Schemas.ChatRoomUserParticipant,
    mentions: [ComposerMention] = [],
    quote: Components.Schemas.ChatRoomMessageQuote? = nil,
    settled: @escaping (Result<Message, Error>) -> Void
  ) -> Bool {
    let draft = ComposerContent(content)
    guard let parent, draft.canSend else { return false }
    let id = UUID().uuidString
    let shell = OutboundShell(clientTurnId: id, roomId: parent.roomId, parentMessageId: parent.id,
                              content: draft.text, quote: quote, sender: sender)
    outbox.enqueue(shell, send: { [service] in
      try await service.createMessage(
        client: client, roomId: parent.roomId, content: draft.text, clientMessageId: id,
        parentMessageId: parent.id, mentions: mentions, quoteMessageId: quote?.messageId, organizationSlug: organizationSlug
      )
    }, confirmed: { [weak self] message in
      guard let self else { return }
      timeline.messages = confirmOutbound(
        messages: timeline.messages, shells: [], confirmed: message, clientTurnId: id
      ).messages
      if var updated = self.parent {
        updated.threadReplyCount += 1
        updated.threadLastReplyAt = message.createdAt
        self.parent = updated
      }
      settled(.success(message))
    }, failed: { settled(.failure($0)) })
    return true
  }

  public func apply(eventType: ChatRoomMessageRealtimeEventType, message: Message) {
    guard let parent, message.roomId == parent.roomId else { return }
    if message.id == parent.id, message.parentMessageId == nil {
      if eventType == .delete, message.deletedAt == nil {
        close()
      } else {
        self.parent = message
      }
      return
    }
    let result = applyRealtimeFullEvent(
      messages: timeline.messages, shells: outbox.shells,
      eventType: eventType, message: message, parentMessageId: parent.id
    )
    timeline.messages = result.messages
    outbox.reconcile(result.shells, confirmed: message)
  }

  public func apply(_ patch: RealtimeMessagePatch) {
    guard let parent, patch.roomId == parent.roomId else { return }
    if patch.messageId == parent.id, patch.parentMessageId == nil {
      self.parent = applyRealtimePatch(patch, messages: [parent]).first
    } else {
      timeline.messages = applyRealtimePatch(patch, messages: timeline.messages, parentMessageId: parent.id)
    }
  }

  /// Root hydration and reply hydration use different endpoints. A root
  /// envelope returns true so the caller can refresh the parent separately.
  @discardableResult
  public func apply(_ envelope: ChatRoomMessageIdEnvelope) -> Bool {
    guard let parent, envelope.roomId == parent.roomId else { return false }
    if envelope.messageId == parent.id, envelope.parentMessageId == nil {
      if envelope.eventType == .delete {
        self.parent = tombstoneTranscriptMessage(parent)
        return false
      }
      return true
    }
    switch resolveRealtimeEnvelope(envelope, focusedRoomId: parent.roomId, parentMessageId: parent.id) {
    case let .tombstone(id):
      timeline.messages = applyRealtimeTombstone(messages: timeline.messages, messageId: id)
    case .needsRefetch:
      recovery.requestRefresh()
    case .ignore: break
    }
    return false
  }
}
