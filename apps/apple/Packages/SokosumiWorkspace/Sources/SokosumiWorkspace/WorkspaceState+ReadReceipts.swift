import CoreAPI
import Foundation
import SokosumiChat

/// Seen by (row 31b1, web `useRoomReadReceipts`): the transcript room's payload marks with the live
/// `chat_room_read` marks on top. The marks follow the transcript's room through `watchRoom`.
public extension WorkspaceState {
  /// Room read receipts for the room the transcript shows; empty when it shows none.
  var roomReadReceipts: RoomReadReceipts {
    readReceipts(for: transcriptRoomId.flatMap { id in rooms.first { $0.id == id } })
  }

  /// Room read receipts for `room`, the payload's marks with the live marks on top while it is the open room. The
  /// Members inspector (row 31b2) reads its room through this, as the transcript's Seen by does.
  func readReceipts(for room: Components.Schemas.ChatRoom?) -> RoomReadReceipts {
    RoomReadReceipts(room: room, currentUserId: currentUserId, liveReads: roomReads.roomId == room?.id ? roomReads.marks : [:])
  }
}

extension WorkspaceState {
  func applyRoomRead(_ event: ChatRoomReadEvent) {
    roomReads.apply(event)
  }
}
