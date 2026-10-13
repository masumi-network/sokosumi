import Combine
import CoreAPI

/// Every copy of a confirmed message the reader has loaded: the open room's Transcript, the open Thread's parent and
/// its replies. A change to one message reaches each copy through here, so no caller has to know where copies live.
/// The viewer's Pending reactions sit on top of every copy until Core answers (ADR 0032).
@MainActor
public final class LoadedMessages: ObservableObject {
  public typealias Message = Components.Schemas.ChatRoomMessage

  public let room: TranscriptSession
  public let thread: ThreadSession
  /// The viewer's unconfirmed reaction taps; display overlays them on each copy.
  @Published public private(set) var pendingReactions = PendingReactions()
  private let service = ChatService()

  public init(room: TranscriptSession, thread: ThreadSession) {
    self.room = room
    self.thread = thread
  }

  /// Every loaded copy: the room's history, then the Thread's parent, then its replies.
  public var all: [Message] {
    room.timeline.messages + (thread.parent.map { [$0] } ?? []) + thread.transcript.timeline.messages
  }

  /// The first loaded copy, in the order of `all`.
  internal func message(_ id: String) -> Message? {
    room.timeline.messages.first { $0.id == id }
      ?? (thread.parent?.id == id ? thread.parent : nil)
      ?? thread.transcript.timeline.messages.first { $0.id == id }
  }

  /// A confirmed create, update or delete: the Thread places its parent and replies, the room its own history.
  public func apply(eventType: ChatRoomMessageRealtimeEventType, message: Message) {
    thread.apply(eventType: eventType, message: message)
    room.apply(eventType: eventType, message: message)
  }

  public func apply(_ patch: RealtimeMessagePatch) {
    thread.apply(patch)
    room.apply(patch)
  }

  /// Applies `transform` to each loaded copy of a message on its own. The Thread's parent is a snapshot with its own
  /// unread state, so it is transformed, never replaced by the room's copy. A message that is not loaded stays absent.
  public func update(_ id: String, _ transform: (Message) -> Message) {
    room.update(id, transform)
    if let parent = thread.parent, parent.id == id {
      thread.apply(eventType: .update, message: transform(parent))
    }
    thread.transcript.update(id, transform)
  }

  /// Shows the tap at once and tells Core the end state (ADR 0032). Requests for one message and emoji run one at a
  /// time and only the newest intent is sent; a tap that lands while one is running returns at once. The request
  /// outlives leaving the room. Returns whether this call's requests ended with the viewer's reaction on the message;
  /// a failure drops only this emoji's intent and rethrows.
  @discardableResult
  public func toggleReaction(_ source: Message, emoji: String, client: Client, organizationSlug: String?) async throws -> Bool {
    let confirmed = message(source.id) ?? source
    let confirmedReacted = confirmed.reactions.contains { $0.emoji == emoji && $0.reactedByCurrentUser }
    guard var sent = pendingReactions.tap(messageId: source.id, emoji: emoji, confirmedReacted: confirmedReacted) else { return false }
    defer { pendingReactions.settle(messageId: source.id, emoji: emoji) }
    while true {
      let response = if sent {
        try await service.addReaction(client: client, roomId: source.roomId, messageId: source.id, emoji: emoji,
                                      organizationSlug: organizationSlug)
      } else {
        try await service.removeReaction(client: client, roomId: source.roomId, messageId: source.id, emoji: emoji,
                                         organizationSlug: organizationSlug)
      }
      // Matched by message and room id, so a room left meanwhile is untouched.
      update(response.id) { applyingReactionResponse(response, emoji: emoji, to: $0) }
      guard let next = pendingReactions.intent(messageId: source.id, emoji: emoji, after: sent) else { return sent }
      sent = next
    }
  }

  /// Sign-out or a workspace switch: no tap from the last session stays on screen.
  public func clearPendingReactions() {
    pendingReactions = PendingReactions()
  }
}
