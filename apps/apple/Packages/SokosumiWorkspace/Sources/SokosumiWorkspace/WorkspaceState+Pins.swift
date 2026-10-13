import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  /// Pins or unpins in the open room; the sidebar row takes Core's new count, as it does from a live pin event.
  func setPinned(_ pinned: Bool, messageId: String) async throws {
    guard let roomId = transcriptRoomId, let count = try await openRoom.setPinned(pinned, messageId: messageId),
          let index = rooms.firstIndex(where: { $0.id == roomId }) else { return }
    rooms[index].pinnedMessageCount = count
  }
}
