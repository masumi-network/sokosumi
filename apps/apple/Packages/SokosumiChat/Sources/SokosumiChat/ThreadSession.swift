import Combine
import CoreAPI
import Foundation

/// One open thread: its parent, the reader's mute and the replies' Transcript. The parent is separate from replies so
/// parent edits never duplicate the root below the divider. Closing drops only local send state.
@MainActor
public final class ThreadSession: ObservableObject {
  public typealias Message = Components.Schemas.ChatRoomMessage

  @Published public private(set) var parent: Message?
  /// The reader's mute on this thread; nil while no thread is open.
  @Published public private(set) var mute: ThreadMuteState?
  /// The replies below the parent.
  public let transcript: TranscriptSession
  private let service = ChatService()
  private let now: () -> Date

  /// `sleep` paces the recovery timer and the Send queue's timers.
  public init(now: @escaping () -> Date = Date.init, makeId: @escaping () -> String = { UUID().uuidString },
              sleep: @escaping (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
    self.now = now
    transcript = TranscriptSession(now: now, makeId: makeId, sleep: sleep)
  }

  @discardableResult
  public func open(_ message: Message) -> Bool {
    guard message.parentMessageId == nil, !isOutboundLocalMessage(message) else { return false }
    if parent?.id == message.id {
      parent = message
      return true
    }
    transcript.open(roomId: message.roomId, parentMessageId: message.id)
    parent = message
    mute = ThreadMuteState(roomId: message.roomId, parentMessageId: message.id)
    return true
  }

  public func close() {
    transcript.close()
    parent = nil
    mute = nil
  }

  /// Reads the mute while it is unknown. A 404 (the parent has no live reply yet) keeps it unknown, so the
  /// caller reads again when the first reply lands.
  public func readMute(client: Client, organizationSlug: String?) async throws {
    guard let parent, mute?.needsRead == true else { return }
    let generation = transcript.timeline.generation
    let thread = try await service.getThread(
      client: client, roomId: parent.roomId, parentMessageId: parent.id, organizationSlug: organizationSlug
    )
    guard generation == transcript.timeline.generation else { return }
    mute?.read(mutedAt: thread.mutedAt)
  }

  /// Flips the mute at once and asks Core for it; returns whether Core changed it, which moves the room's
  /// unread even after the reader left the thread. A failure reverts and keeps the failure for the view.
  @discardableResult
  public func toggleMute(client: Client, organizationSlug: String?) async throws -> Bool {
    guard let parent, let muted = mute?.beginToggle() else { return false }
    let generation = transcript.timeline.generation
    do {
      let thread = if muted {
        try await service.muteThread(client: client, roomId: parent.roomId, parentMessageId: parent.id, organizationSlug: organizationSlug)
      } else {
        try await service.unmuteThread(client: client, roomId: parent.roomId, parentMessageId: parent.id, organizationSlug: organizationSlug)
      }
      if generation == transcript.timeline.generation {
        mute?.settle(mutedAt: thread.mutedAt)
      }
      return true
    } catch {
      if generation == transcript.timeline.generation {
        mute?.fail()
      }
      throw error
    }
  }

  public func dismissMuteFailure() {
    mute?.dismissFailure()
  }

  /// The caller performs its visibility-gated room read after this succeeds,
  /// before fetching replies, matching web's thread-look then room-read order.
  public func markLooked(client: Client, organizationSlug: String?) async throws -> Bool {
    guard let parent else { return false }
    let generation = transcript.timeline.generation
    _ = try await service.markThreadRead(
      client: client, roomId: parent.roomId, parentMessageId: parent.id,
      organizationSlug: organizationSlug
    )
    return generation == transcript.timeline.generation && !Task.isCancelled
  }

  /// A reply, sent through the Transcript; once Core confirms it the parent's reply bar counts it.
  @discardableResult
  public func send(
    _ content: String, client: Client, organizationSlug: String?,
    sender: Components.Schemas.ChatRoomUserParticipant,
    mentions: [ComposerMention] = [],
    quote: Components.Schemas.ChatRoomMessageQuote? = nil,
    skills: [Components.Schemas.ChatRoomMessageSkill] = [],
    settled: @escaping (Result<Message, Error>) -> Void
  ) -> Bool {
    guard parent != nil else { return false }
    return transcript.send(
      content, client: client, organizationSlug: organizationSlug, sender: sender,
      mentions: mentions, quote: quote, skills: skills
    ) { [weak self] result in
      if case let .success(message) = result, let self, let parent {
        self.parent = applyingReplyToParentThreadPreview(parent, reply: message)
      }
      settled(result)
    }
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
    transcript.apply(eventType: eventType, message: message)
  }

  public func apply(_ patch: RealtimeMessagePatch) {
    guard let parent, patch.roomId == parent.roomId else { return }
    if patch.messageId == parent.id, patch.parentMessageId == nil {
      self.parent = applyRealtimePatch(patch, messages: [parent]).first
    } else {
      transcript.apply(patch)
    }
  }

  /// Root hydration and reply hydration use different endpoints. A root
  /// envelope returns true so the caller can refresh the parent separately.
  @discardableResult
  public func apply(_ envelope: ChatRoomMessageIdEnvelope) -> Bool {
    guard let parent, envelope.roomId == parent.roomId else { return false }
    if envelope.messageId == parent.id, envelope.parentMessageId == nil {
      if envelope.eventType == .delete {
        self.parent = tombstoneTranscriptMessage(parent, now: now())
        return false
      }
      return true
    }
    transcript.apply(envelope)
    return false
  }
}
