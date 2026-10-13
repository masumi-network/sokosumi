import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  func removeUnfurl(_ source: Components.Schemas.ChatRoomMessage, url: String) async throws {
    guard source.roomId == transcriptRoomId, canModifyOwnMessage(source, userId: currentUserId) else { return }
    let generation = openRoom.room.timeline.generation
    do {
      _ = try await request(signIn: "Log in to remove link previews.") { service, client, slug in
        try await service.removeUnfurl(client: client, roomId: source.roomId, messageId: source.id, url: url, organizationSlug: slug)
      }
      guard generation == openRoom.room.timeline.generation, !Task.isCancelled else { return }
      /// Remove only this URL: a full response could overwrite a newer edit or another removal.
      func removingPreview(_ message: Components.Schemas.ChatRoomMessage) -> Components.Schemas.ChatRoomMessage {
        guard message.id == source.id, message.deletedAt == nil else { return message }
        var updated = message
        updated.unfurls = message.unfurls?.filter { $0.url != url }
        return updated
      }
      openRoom.loaded.update(source.id, removingPreview)
    } catch {
      guard generation == openRoom.room.timeline.generation, !Task.isCancelled else { return }
      throw error
    }
  }
}
