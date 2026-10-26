import Combine
import SokosumiWorkspace

/// Stands in for the room's list, which reports the end of the transcript as soon as it mounts there: every room the
/// workspace opens is at its end until a test says otherwise (SOK-1484). Without it no room is ever read.
@MainActor private var roomListsAtTheEnd: [AnyCancellable] = []

@MainActor
func keepRoomListAtTheEnd(_ state: WorkspaceState) {
  let room = state.openRoom.room
  roomListsAtTheEnd.append(room.timeline.$roomId.sink { roomId in
    if roomId != nil {
      room.setAtEnd(true)
    }
  })
}
