import CoreAPI

/// The room list's writes. A change that Core or a live event reports reaches the list through one of these, and each
/// says whether a list read already in flight predates it: a read that did must not overwrite the change when it lands.
public extension ConversationSidebar {
  /// Takes Core's room in place of the listed one after a change Core answered with its room. A list read already
  /// in flight predates the change, so its late answer is dropped. A room that is not listed stays unlisted.
  func replace(_ room: Components.Schemas.ChatRoom) {
    invalidateRefresh()
    if let index = rooms.firstIndex(where: { $0.id == room.id }) {
      rooms[index] = room
    }
  }

  /// Changes the listed room in place. `invalidatingRefresh` drops a list read in flight, for a change that read
  /// predates; a live detail that only adds to the room leaves the read alone. Returns whether the room is listed.
  @discardableResult
  func update(_ roomId: String, invalidatingRefresh: Bool, _ change: (inout Components.Schemas.ChatRoom) -> Void) -> Bool {
    if invalidatingRefresh {
      invalidateRefresh()
    }
    guard let index = rooms.firstIndex(where: { $0.id == roomId }) else { return false }
    change(&rooms[index])
    return true
  }

  /// A room the reader just created, joined or opened: it replaces the listed one or joins the end of the list. A
  /// list read in flight predates it and would answer without it, so that read's late answer is dropped.
  func upsert(_ room: Components.Schemas.ChatRoom) {
    invalidateRefresh()
    if let index = rooms.firstIndex(where: { $0.id == room.id }) {
      rooms[index] = room
    } else {
      rooms.append(room)
    }
  }

  /// Drops a room whose membership is gone (SOK-742): a list read in flight and the room's own pending pin or mute
  /// end with it, and the selection clears when the room was selected. Other rooms' pending actions stay.
  func revoke(roomId: String) {
    invalidateRefresh()
    rollbackPendingAction(roomId: roomId)
    let result = applyMembershipRevoked(rooms: rooms, selectedRoomId: selectedRoomId, revokedRoomId: roomId)
    rooms = result.rooms
    selectedRoomId = result.selectedRoomId
  }
}
