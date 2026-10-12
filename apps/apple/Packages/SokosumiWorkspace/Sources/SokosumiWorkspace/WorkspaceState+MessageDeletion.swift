import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  func deleteMessage(_ source: Components.Schemas.ChatRoomMessage, auth: AuthState) async throws {
    guard source.roomId == transcriptRoomId, source.deletedAt == nil else { return }
    guard let client = resolveClient(auth: auth) else {
      throw ChatServiceError.unauthorized("Log in to delete messages.")
    }
    let generation = room.timeline.generation
    let parentId = source.parentMessageId
    let parentCount = parentId.flatMap { id in
      thread.parent?.id == id ? thread.parent?.threadReplyCount : room.timeline.messages.first { $0.id == id }?.threadReplyCount
    }
    do {
      let message = try await ChatService().deleteMessage(client: client, roomId: source.roomId, messageId: source.id,
                                                          organizationSlug: selection?.workspace.organizationSlug)
      guard generation == room.timeline.generation, message.roomId == transcriptRoomId, !Task.isCancelled else { return }
      loaded.apply(eventType: .delete, message: message)
      if messageEditing.source?.id == message.id {
        messageEditing.reset()
      }
      if message.deletedAt != nil, let parentId, let parentCount {
        loaded.update(parentId) { applyingReplyDeletion(to: $0, parentId: parentId, previousReplyCount: parentCount) }
      }
    } catch {
      guard generation == room.timeline.generation else { return }
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
      throw error
    }
  }
}
