import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  func removeUnfurl(_ source: Components.Schemas.ChatRoomMessage, url: String, auth: AuthState) async throws {
    guard source.roomId == transcriptRoomId, canModifyOwnMessage(source, userId: currentUserId) else { return }
    guard let client = resolveClient(auth: auth) else {
      throw ChatServiceError.unauthorized("Sign in to remove link previews.")
    }
    let generation = timeline.generation
    do {
      _ = try await ChatService().removeUnfurl(client: client, roomId: source.roomId, messageId: source.id,
                                               url: url, organizationSlug: selection?.workspace.organizationSlug)
      guard generation == timeline.generation, !Task.isCancelled else { return }
      /// Remove only this URL: a full response could overwrite a newer edit or another removal.
      func removingPreview(_ message: Components.Schemas.ChatRoomMessage) -> Components.Schemas.ChatRoomMessage {
        guard message.id == source.id, message.deletedAt == nil else { return message }
        var updated = message
        updated.unfurls = message.unfurls?.filter { $0.url != url }
        return updated
      }
      timeline.messages = timeline.messages.map(removingPreview)
      if let parent = thread.parent {
        thread.apply(eventType: .update, message: removingPreview(parent))
      }
      thread.timeline.messages = thread.timeline.messages.map(removingPreview)
    } catch {
      guard generation == timeline.generation, !Task.isCancelled else { return }
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
      throw error
    }
  }
}
