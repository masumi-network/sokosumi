import CoreAPI
import Foundation
import SokosumiAuth
import SokosumiChat

/// The chat-level Threads view (row 24f1, web `/chat/threads`). It takes the detail column in place of the
/// selected room, which stays selected behind it but is off screen: no read runs there until the reader
/// comes back to it. A row opens its Thread in its room through `openRoomLink`, which also leaves the view.
public extension WorkspaceState {
  enum CrossRoomThreadsAction { case unread, olderUnread, earlier, olderEarlier }

  /// The rooms are Core's answer, not an empty list still loading, so a zero in their counts says the
  /// reader is caught up (web's `roomsLive`).
  var roomsLive: Bool {
    !(roomsLoading && rooms.isEmpty)
  }

  func showThreadsView() {
    sidebar.showsThreadsView = true
  }

  /// The reader picked a room in the sidebar. Coming back to the room that was behind the Threads view
  /// reads what is now on screen.
  func showRoom(_ id: String, auth: AuthState) async {
    let wasBehind = sidebar.showsThreadsView && id == selectedRoomId
    sidebar.showsThreadsView = false
    selectRoom(id, auth: auth)
    if wasBehind {
      await syncReadAttention(auth: auth)
    }
  }

  /// The sidebar's overflow row under a room (row 24g2, web's `?threads=1`): shows that room, in place of the
  /// Threads view when that is up, with its thread overview open. An open thread is put away first, as web's
  /// `showThreadList` does; the room's tools open the overview once the room is on screen.
  func openThreadOverview(roomId: String, auth: AuthState) async {
    guard rooms.contains(where: { $0.id == roomId }) else { return }
    thread.close()
    threadOverviewRequest = ThreadOverviewRequest(roomId: roomId)
    await showRoom(roomId, auth: auth)
  }

  func consumeThreadOverviewRequest(_ requestId: UUID) {
    if threadOverviewRequest?.requestId == requestId {
      threadOverviewRequest = nil
    }
  }

  func updateCrossRoomThreads(_ action: CrossRoomThreadsAction, auth: AuthState) async {
    guard let client = resolveClient(auth: auth) else { return }
    let rooms = rooms
    if action == .unread, !CrossRoomThreads.shouldLoadUnread(rooms: rooms, roomsLive: roomsLive) {
      return
    }
    let list: CrossRoomThreadList = action == .unread || action == .olderUnread ? .unread : .earlier
    do {
      try await crossRoomThreads.load(list, older: action == .olderUnread || action == .olderEarlier, rooms: rooms,
                                      scope: selectionId, client: client, organizationSlug: selection?.workspace.organizationSlug)
    } catch {
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
    }
  }
}
