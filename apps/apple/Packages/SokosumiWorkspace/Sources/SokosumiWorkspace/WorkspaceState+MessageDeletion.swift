import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  func deleteMessage(_ source: Components.Schemas.ChatRoomMessage, auth: AuthState) async throws {
    guard source.roomId == transcriptRoomId, source.deletedAt == nil else { return }
    guard let client = resolveClient(auth: auth) else {
      throw ChatServiceError.unauthorized("Sign in to delete messages.")
    }
    let generation = timeline.generation
    let parentId = source.parentMessageId
    let parentCount = parentId.flatMap { id in
      thread.parent?.id == id ? thread.parent?.threadReplyCount : timeline.messages.first { $0.id == id }?.threadReplyCount
    }
    do {
      let message = try await ChatService().deleteMessage(client: client, roomId: source.roomId, messageId: source.id,
                                                          organizationSlug: selection?.workspace.organizationSlug)
      guard generation == timeline.generation, message.roomId == transcriptRoomId, !Task.isCancelled else { return }
      thread.apply(eventType: .delete, message: message)
      timeline.messages = applyRealtimeFullEvent(messages: timeline.messages, shells: [], eventType: .delete, message: message).messages
      if messageEditing.source?.id == message.id {
        messageEditing.reset()
      }
      if message.deletedAt != nil, let parentId, let parentCount {
        timeline.messages = timeline.messages.map { parent in
          applyingReplyDeletion(to: parent, parentId: parentId, previousReplyCount: parentCount)
        }
        if let parent = thread.parent, parent.id == parentId {
          thread.apply(eventType: .update, message: applyingReplyDeletion(to: parent, parentId: parentId, previousReplyCount: parentCount))
        }
      }
    } catch {
      guard generation == timeline.generation else { return }
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
      throw error
    }
  }
}
