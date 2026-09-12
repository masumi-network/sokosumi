import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  func startEditing(_ message: Components.Schemas.ChatRoomMessage) {
    guard message.roomId == transcriptRoomId else { return }
    messageEditing.start(message, userId: currentUserId)
  }

  func saveMessageEdit(auth: AuthState) async {
    guard let client = resolveClient(auth: auth) else { return }
    let generation = timeline.generation
    do {
      guard let message = try await messageEditing.save(client: client, organizationSlug: selection?.workspace.organizationSlug),
            generation == timeline.generation, message.roomId == transcriptRoomId else { return }
      thread.apply(eventType: .update, message: message)
      timeline.messages = applyRealtimeFullEvent(messages: timeline.messages, shells: [], eventType: .update, message: message).messages
    } catch {
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
    }
  }
}
