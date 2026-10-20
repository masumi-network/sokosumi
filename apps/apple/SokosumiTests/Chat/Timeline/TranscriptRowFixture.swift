#if os(macOS)
  import CoreAPI
  import SokosumiChat

  /// The row a room transcript derives for a fixture message drawn on its own: a room that takes messages, read by
  /// `viewerId` (empty owns nothing), with pins when `allowsPins` (a channel's) and Threads unless `allowsThreads` is
  /// false (a Thread's own rows). The rules themselves are covered by `MessageRowTests` in SokosumiChat.
  func transcriptRow(
    _ message: Components.Schemas.ChatRoomMessage,
    viewerId: String = "",
    allowsPins: Bool = false,
    allowsThreads: Bool = true,
    previous: Components.Schemas.ChatRoomMessage? = nil,
    isNewest: Bool = false,
    editing: Bool = false
  ) -> MessageRow {
    let context = TranscriptContext(room: nil, viewerId: viewerId, allowsPins: allowsPins, allowsThreads: allowsThreads,
                                    editingMessageId: editing ? message.id : nil)
    return MessageRow(message, in: context, previous: previous, isNewest: isNewest)
  }
#endif
