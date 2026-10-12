import CoreAPI

/// Every copy of a confirmed message the reader has loaded: the open room's Transcript, the open Thread's parent and
/// its replies. A change to one message reaches each copy through here, so no caller has to know where copies live.
@MainActor
public struct LoadedMessages {
  public typealias Message = Components.Schemas.ChatRoomMessage

  public let room: TranscriptSession
  public let thread: ThreadSession

  public init(room: TranscriptSession, thread: ThreadSession) {
    self.room = room
    self.thread = thread
  }

  /// Every loaded copy: the room's history, then the Thread's parent, then its replies.
  public var all: [Message] {
    room.timeline.messages + (thread.parent.map { [$0] } ?? []) + thread.transcript.timeline.messages
  }

  /// The first loaded copy, in the order of `all`.
  public func message(_ id: String) -> Message? {
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
}
