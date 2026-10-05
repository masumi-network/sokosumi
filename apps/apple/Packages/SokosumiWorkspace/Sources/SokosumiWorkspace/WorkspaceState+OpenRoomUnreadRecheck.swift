import SokosumiChat

/// Web's `useOpenRoomUnreadRecheck` (row 07e): a message realtime missed (an id envelope whose read the cooldown
/// held, an event a reattach dropped) never reaches the transcript, so read attention never clears what the room
/// list still counts. Four seconds after the open room's count last changed, while it still counts, the room is
/// read once more.
extension WorkspaceState {
  /// The open room as the sidebar holds it, read overlays applied. Behind the Threads view no room is on screen,
  /// as no room view is mounted on web's `/chat/threads`.
  var openRoomUnreadSignal: OpenRoomUnreadRecheck.Signal? {
    guard !sidebar.showsThreadsView, let roomId = transcriptRoomId else { return nil }
    return .init(room: rooms.first { $0.id == roomId }, historyLoading: transcriptLoading)
  }

  func watchOpenRoomUnread() {
    openRoomUnreadRecheck.watch(objectWillChange, signal: { [weak self] in
      self?.openRoomUnreadSignal
    }, request: { [weak self] in
      self?.recheckOpenRoom()
    })
  }

  /// Web asks the open room's one scheduler, whose read also takes an open Thread's latest page
  /// (`refreshFocusedRoomMessages`); Apple keeps the two in separate schedulers and asks both, as lost continuity does.
  private func recheckOpenRoom() {
    transcriptRecovery.requestRefresh()
    thread.recovery.requestRefresh()
  }
}
