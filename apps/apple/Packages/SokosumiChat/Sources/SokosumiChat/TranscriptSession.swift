import Combine
import CoreAPI
import Foundation

/// One Transcript: a Room's or a Thread's messages as the reader sees them, confirmed history plus the Send queue's
/// Pending messages and Failed sends, with its page loads, sends, realtime updates and jump. `open` scopes it to a
/// room, or to a Thread's replies with `parentMessageId`; `close` drops only local state.
@MainActor
public final class TranscriptSession: ObservableObject {
  public typealias Message = Components.Schemas.ChatRoomMessage

  public struct JumpTarget: Equatable, Sendable {
    public let requestId = UUID()
    public let messageId: String
    /// Nil until the prepared row is ready to land. Its hold must not consume a pending jump.
    public fileprivate(set) var mark: JumpMark?
  }

  @Published public private(set) var jumpTarget: JumpTarget?
  public let timeline = RoomTimeline()
  public let outbox: RoomOutbox
  public let recovery: ChatRefreshScheduler
  public private(set) var loadTask: Task<Void, Never>?
  private var transcriptObservation: AnyCancellable?
  private let service = ChatService()
  private let now: () -> Date
  private let makeId: () -> String

  /// `sleep` paces the recovery timer and the Send queue's timers.
  public init(now: @escaping () -> Date = Date.init, makeId: @escaping () -> String = { UUID().uuidString },
              sleep: @escaping (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
    self.now = now
    self.makeId = makeId
    recovery = ChatRefreshScheduler(sleep: sleep)
    outbox = RoomOutbox(now: now, sleep: sleep)
    transcriptObservation = timeline.$messages.sink { [weak outbox] in outbox?.reconcile(messages: $0) }
  }

  /// Confirmed history with unresolved Pending messages and Failed sends at the end.
  public var displayedMessages: [Message] {
    displayedTranscript(messages: timeline.messages, shells: outbox.shells)
  }

  public func open(roomId: String, parentMessageId: String? = nil) {
    stop()
    timeline.reset(roomId: roomId, parentMessageId: parentMessageId)
  }

  public func close() {
    stop()
    timeline.reset()
  }

  /// Drops what the previous scope left running: its jump, page load, recovery and Send queue. The timeline resets
  /// once, in `open` or `close`, so it never publishes an empty scope between two rooms.
  private func stop() {
    jumpTarget = nil
    loadTask?.cancel()
    loadTask = nil
    recovery.stop()
    outbox.reset()
  }

  public func requestJump(to messageId: String) {
    guard timeline.messages.contains(where: { $0.id == messageId }) else { return }
    jumpTarget = JumpTarget(messageId: messageId)
  }

  /// Start the hold only after the view has issued the scroll to the prepared row. A late acknowledgement
  /// cannot mark a replacement request, and another layout pass cannot restart an existing hold.
  public func landJump(_ requestId: UUID) {
    guard let target = jumpTarget, target.requestId == requestId, target.mark == nil else { return }
    jumpTarget?.mark = JumpMark(messageId: target.messageId, landedAt: now())
  }

  /// A reader scroll (web `fadeOutHighlight`): the mark fades out, or ends outright outside its full-strength stretch.
  public func readerScrolled() {
    guard let target = jumpTarget, let currentMark = target.mark else { return }
    guard let mark = currentMark.readerScrolled(at: now()) else { return clearJump() }
    if mark != target.mark {
      jumpTarget?.mark = mark
    }
  }

  /// Drop the jump once its mark has run out (web `landOn`'s timer).
  public func endJumpIfMarkEnded() {
    if jumpTarget?.mark?.stage(at: now()) == .ended {
      clearJump()
    }
  }

  public func clearJump() {
    guard jumpTarget != nil else { return }
    jumpTarget = nil
  }

  /// Serialize page reads. Initial attention precedes the first GET;
  /// subsequent reads update attention after the new content is available.
  public func loadPage(
    _ page: RoomTimeline.Page, client: Client, organizationSlug: String?,
    syncAttention: @escaping () async -> Void, failed: @escaping (Error) -> Void
  ) {
    guard timeline.roomId != nil, loadTask == nil else { return }
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

  /// Queue a Pending message at once, then POST in order. Invalid drafts stay with the composer; accepted sends keep
  /// a stable client turn id for safe retries.
  @discardableResult
  public func send(
    _ content: String, client: Client, organizationSlug: String?,
    sender: Components.Schemas.ChatRoomUserParticipant,
    mentions: [ComposerMention] = [],
    quote: Components.Schemas.ChatRoomMessageQuote? = nil,
    skills: [Components.Schemas.ChatRoomMessageSkill] = [],
    settled: @escaping (Result<Message, Error>) -> Void
  ) -> Bool {
    let draft = ComposerContent(content)
    guard let roomId = timeline.roomId, draft.canSend(quoted: quote != nil) else { return false }
    let parentMessageId = timeline.parentMessageId
    let id = makeId()
    let shell = OutboundShell(
      clientTurnId: id, roomId: roomId, parentMessageId: parentMessageId,
      content: draft.text, quote: quote, skills: skills, createdAt: now(), sender: sender
    )
    outbox.enqueue(shell, send: { [service] in
      try await service.createMessage(
        client: client, roomId: roomId, content: draft.text, clientMessageId: id,
        parentMessageId: parentMessageId, mentions: mentions, quote: quote, skillIds: skills.map(\.id),
        organizationSlug: organizationSlug
      )
    }, confirmed: { [weak self] message in
      guard let self else { return }
      timeline.messages = confirmOutbound(
        messages: timeline.messages, shells: [], confirmed: message, clientTurnId: id
      ).messages
      settled(.success(message))
    }, failed: { settled(.failure($0)) })
    return true
  }

  public func apply(eventType: ChatRoomMessageRealtimeEventType, message: Message) {
    guard let roomId = timeline.roomId, message.roomId == roomId else { return }
    let result = applyRealtimeFullEvent(
      messages: timeline.messages, shells: outbox.shells,
      eventType: eventType, message: message, parentMessageId: timeline.parentMessageId
    )
    timeline.messages = result.messages
    outbox.reconcile(result.shells, confirmed: message)
  }

  public func apply(_ patch: RealtimeMessagePatch) {
    guard let roomId = timeline.roomId, patch.roomId == roomId else { return }
    timeline.messages = applyRealtimePatch(patch, messages: timeline.messages, parentMessageId: timeline.parentMessageId)
  }

  /// A tombstone applies at once; anything that needs the message's content asks recovery to refetch. Returns how the
  /// envelope resolved, so a caller can act on one this Transcript ignores.
  @discardableResult
  public func apply(_ envelope: ChatRoomMessageIdEnvelope) -> ChatRoomMessageEnvelopeResolution {
    guard let roomId = timeline.roomId, envelope.roomId == roomId else { return .ignore }
    let resolution = resolveRealtimeEnvelope(envelope, focusedRoomId: roomId, parentMessageId: timeline.parentMessageId)
    switch resolution {
    case let .tombstone(id):
      timeline.messages = applyRealtimeTombstone(messages: timeline.messages, messageId: id, now: now())
    case .needsRefetch:
      recovery.requestRefresh()
    case .ignore: break
    }
    return resolution
  }
}
