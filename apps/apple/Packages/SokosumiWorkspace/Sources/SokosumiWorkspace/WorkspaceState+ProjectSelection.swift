import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  /// Answers a Soko Bot's `project_selection` card with the picked project (row 38h1, web `selectChatProjectAction`).
  /// The saved reply lands in the room or its Thread at once, as its realtime copy would; a 401 signs out like every
  /// other chat request, anything else reaches the picker as "Could not send your choice".
  func selectProject(_ projectId: String, preview previewId: String, question message: Components.Schemas.ChatRoomMessage,
                     auth: AuthState) async throws {
    guard let client = resolveClient(auth: auth) else {
      throw ChatServiceError.unauthorized("Log in to send your choice.")
    }
    do {
      let reply = try await ChatService().selectProject(client: client, question: message, previewId: previewId, projectId: projectId,
                                                        userId: currentUserId, organizationSlug: selection?.workspace.organizationSlug)
      applyRealtimeMessage(roomId: reply.roomId, eventType: .create, message: reply)
    } catch {
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
      throw error
    }
  }
}
