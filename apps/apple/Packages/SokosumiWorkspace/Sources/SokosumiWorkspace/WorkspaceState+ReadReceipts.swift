import CoreAPI
import Foundation
import SokosumiChat

/// Seen by (row 31b1, web `useRoomReadReceipts`): the transcript room's payload marks with the live
/// `chat_room_read` marks on top. The marks follow the transcript's room through `watchRoom`.
public extension WorkspaceState {
  /// Room read receipts for the room the transcript shows; empty when it shows none.
  var roomReadReceipts: RoomReadReceipts {
    let room = transcriptRoomId.flatMap { id in rooms.first { $0.id == id } }
    return RoomReadReceipts(room: room, currentUserId: currentUserId,
                            liveReads: roomReads.roomId == room?.id ? roomReads.marks : [:])
  }
}

extension WorkspaceState {
  func applyRoomRead(_ event: ChatRoomReadEvent) {
    roomReads.apply(event)
  }
}
