import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  func searchMessages(_ query: String, roomId: String, search: RoomSearch) async {
    guard roomId == transcriptRoomId else { search.reset()
      return
    }
    guard let client = resolveClient() else {
      search.fail(ChatServiceError.unauthorized("Log in to search messages."), query: query)
      return
    }
    let generation = openRoom.room.timeline.generation
    await search.search(query: query, roomId: roomId, client: client, organizationSlug: selection?.workspace.organizationSlug)
    guard generation == openRoom.room.timeline.generation else { return }
    if let error = search.failure as? ChatServiceError {
      signOutIfUnauthorized(error)
    }
  }
}
