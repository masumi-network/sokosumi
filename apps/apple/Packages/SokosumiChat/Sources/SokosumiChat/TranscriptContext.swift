import CoreAPI

/// The transcript-wide facts every row of one room or Thread transcript reads: who reads it, what the room accepts,
/// and which row is being edited. One value per transcript render; `MessageRow` combines it with each message.
public struct TranscriptContext: Equatable, Sendable {
  /// The signed-in reader; empty without one, which owns no message.
  public var viewerId: String
  /// False exactly in a Read-only Direct: Core refuses sends, Reactions and Quotes there (403); editing and
  /// deleting one's own messages still works.
  public var takesNewMessages: Bool
  /// The reader's own notes Direct, which sends nothing to yourself.
  public var isSelfDirect: Bool
  /// Channel messages pin; Directs and Threads do not.
  public var allowsPins: Bool
  /// The room transcript opens Threads; the rows inside a Thread do not.
  public var allowsThreads: Bool
  /// The transcript's sends in flight or failed.
  public var outbound: [OutboundShell]
  /// The message whose inline edit composer is open.
  public var editingMessageId: String?

  public init(
    room: Components.Schemas.ChatRoom?,
    viewerId: String,
    allowsPins: Bool,
    allowsThreads: Bool,
    outbound: [OutboundShell] = [],
    editingMessageId: String? = nil
  ) {
    self.viewerId = viewerId
    takesNewMessages = roomTakesNewMessages(room)
    isSelfDirect = room?.isSelfDirect == true
    self.allowsPins = allowsPins
    self.allowsThreads = allowsThreads
    self.outbound = outbound
    self.editingMessageId = editingMessageId
  }

  /// Web's Read-only Direct: everyone else left, so the room only reads.
  public var isReadOnlyDirect: Bool {
    !takesNewMessages
  }
}
