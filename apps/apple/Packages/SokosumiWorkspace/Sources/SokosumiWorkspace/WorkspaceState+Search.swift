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
}
