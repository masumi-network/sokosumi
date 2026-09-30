import Foundation
import SokosumiChat
import SokosumiRealtime

/// Typing lifecycle (ADR 0033, web `RoomTypingProvider` + `useRoomTyping`): the open room's
/// typing channel follows the transcript, the room composer announces on it, and it is told
/// `stopped` on send, on blur and on leaving. The Thread and edit composers announce nothing.
/// Typing feeds nothing else: not presence, not unread, not notifications.
public extension WorkspaceState {
  /// A genuine edit in the room composer: typed or pasted text, a deletion, a formatting
  /// command. Never a restored draft or text the app inserted itself, which is what keeps
  /// opening a room with an abandoned draft silent.
  func composerEdited(roomId: String, hasText: Bool, now: Date) {
    guard roomId == typing.roomId, let state = typing.composerChanged(hasText: hasText, now: now) else { return }
    realtime?.publishTyping(state, roomId: roomId)
  }

  /// The room composer lost focus. Send stops through `sendMessage`. Safe when not announced.
  func composerStoppedTyping(roomId: String) {
    guard roomId == typing.roomId, typing.stop() else { return }
    realtime?.publishTyping(.stopped, roomId: roomId)
  }
}

extension WorkspaceState {
  /// The transcript's room changed (nil: none). Leaving is one of the four stops, sent before
  /// the transport lets the previous room's channel go.
  func watchRoom(_ roomId: String?) {
    if roomId != typing.roomId {
      closeTyping()
      typing.open(roomId: roomId, selfUserId: currentUserId)
    }
    realtime?.watchRoom(roomId)
  }

  /// Tells the open room this client stopped, if it was told otherwise, and forgets the room.
  func closeTyping() {
    if let roomId = typing.roomId {
      composerStoppedTyping(roomId: roomId)
    }
    typingSweepTask?.cancel()
    typingSweepTask = nil
    typing.open(roomId: nil, selfUserId: currentUserId)
  }

  func applyTyping(roomId: String, signal: ChatTypingSignal, now: Date) {
    typing.apply(signal, roomId: roomId, now: now)
    scheduleTypingSweep(now: now)
  }

  func applyTypingChannel(roomId: String, canPublish: Bool?) {
    typing.channelChanged(roomId: roomId, canPublish: canPublish)
  }

  /// Drops whoever went quiet. Web rechecks every second; this looks again exactly when the
  /// next typist expires, so an idle room runs no timer.
  func sweepTyping(now: Date) {
    typing.sweep(now: now)
    scheduleTypingSweep(now: now)
  }

  private func scheduleTypingSweep(now: Date) {
    typingSweepTask?.cancel()
    typingSweepTask = typing.nextExpiry(after: now).map { expiry in
      Task { [weak self] in
        do { try await Task.sleep(for: .seconds(expiry.timeIntervalSince(now))) } catch { return }
        // A paused app may wake after several deadlines. Expire against the wake
        // time, not the old deadline, so stale typists disappear together.
        self?.sweepTyping(now: Date())
      }
    }
  }
}
