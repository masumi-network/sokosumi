import SokosumiAuth

/// History gap rows (row 04a): the page between two loaded ranges that a jump left apart. The room's
/// `TranscriptSession` loads them, one after another; the row's state lives in `RoomTimeline.boundaryLoads`.
public extension WorkspaceState {
  /// A gap row scrolled into or out of view (web's `useLoadWhenVisible`):
  /// in view and idle, it loads itself once.
  func setHistoryGapVisible(before messageId: String, _ isVisible: Bool) {
    connectRoomTranscript()
    room.setGapVisible(before: messageId, isVisible)
  }

  /// A tap on the row, or Try again after a failure. The outcome stays on the row.
  func loadHistoryGap(before messageId: String) {
    connectRoomTranscript()
    room.loadGap(before: messageId)
  }
}
