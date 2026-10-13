import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  func startEditing(_ message: Components.Schemas.ChatRoomMessage) {
    guard message.roomId == transcriptRoomId else { return }
    messageEditing.start(message, userId: currentUserId)
  }

  func saveMessageEdit() async {
    let generation = room.timeline.generation
    // The editor keeps its own failure to show; a rejected session also signs out.
    guard let message = try? await request({ _, client, slug in try await messageEditing.save(client: client, organizationSlug: slug) }),
          generation == room.timeline.generation, message.roomId == transcriptRoomId else { return }
    loaded.apply(eventType: .update, message: message)
  }
}
