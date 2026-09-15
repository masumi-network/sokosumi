import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  func searchMessages(_ query: String, roomId: String, search: RoomSearch, auth: AuthState) async {
    guard roomId == transcriptRoomId else { search.reset()
      return
    }
    guard let client = resolveClient(auth: auth) else {
      search.fail(ChatServiceError.unauthorized("Sign in to search messages."), query: query)
      return
    }
    let generation = timeline.generation
    await search.search(query: query, roomId: roomId, client: client, organizationSlug: selection?.workspace.organizationSlug)
    guard generation == timeline.generation else { return }
    if let error = search.failure as? ChatServiceError {
      signOutIfUnauthorized(error, auth: auth)
    }
  }

  /// Open the parent first, reuse its normal initial load, then fetch a context
  /// window only if the result is outside loaded replies. Every suspension is
  /// guarded against room/thread changes.
  func openSearchReply(_ hit: Components.Schemas.ChatRoomMessage, auth: AuthState) async throws -> Bool {
    guard hit.roomId == transcriptRoomId, let parentId = hit.parentMessageId else { return false }
    guard let client = resolveClient(auth: auth) else {
      throw ChatServiceError.unauthorized("Sign in to view this reply.")
    }
    let generation = timeline.generation
    let slug = selection?.workspace.organizationSlug
    do {
      let parent = try await searchParent(parentId, roomId: hit.roomId, client: client, organizationSlug: slug)
      guard generation == timeline.generation, !Task.isCancelled,
            parent.id == parentId, parent.roomId == hit.roomId, parent.parentMessageId == nil else { return false }
      openThread(parent, auth: auth)
      let threadGeneration = thread.timeline.generation
      await thread.loadTask?.value
      guard generation == timeline.generation, threadGeneration == thread.timeline.generation,
            thread.parent?.id == parentId, !Task.isCancelled else { return false }
      if !thread.timeline.messages.contains(where: { $0.id == hit.id }) {
        guard try await thread.timeline.loadPage(.around(hit.id), client: client, organizationSlug: slug,
                                                 generation: threadGeneration) else { return false }
      }
      guard generation == timeline.generation, threadGeneration == thread.timeline.generation, !Task.isCancelled else { return false }
      thread.requestJump(to: hit.id)
      return thread.jumpTarget?.messageId == hit.id
    } catch {
      guard generation == timeline.generation, !Task.isCancelled else { return false }
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
      throw error
    }
  }

  private func searchParent(_ id: String, roomId: String, client: Client, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomMessage {
    if let loaded = transcriptMessages.first(where: { $0.id == id }) {
      return loaded
    }
    return try await ChatService().getMessage(client: client, roomId: roomId, messageId: id, organizationSlug: organizationSlug)
  }
}
